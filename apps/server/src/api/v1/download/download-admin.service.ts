import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Observable, auditTime, concat, map, of } from 'rxjs';

import { MAX_FILES_PER_DOWNLOAD, ObservedDownload } from '@libs/agent-protocol';
import {
  DownloadFileState,
  DownloadTargetState,
  CreateDownloadRequestDto,
  DownloadDto,
  DownloadListRequestDto,
  DownloadListResponseDto,
  DownloadProgressResponseDto,
  DownloadTargetProgressDto,
  DownloadTargetDto,
  DownloadTargetFileDto,
  RepositoryListingRequestDto,
  RepositoryListingResponseDto,
  StopDownloadRequestDto,
} from '@libs/dto';

import { DownloadFile } from '@/core/download/entities/download-file.entity';
import { DownloadTarget } from '@/core/download/entities/download-target.entity';
import { Download } from '@/core/download/entities/download.entity';

import { ConfigService } from '@/config/config.service';
import { DownloadAdmissionService } from '@/core/download/download-admission.service';
import { DownloadProgressService } from '@/core/download/download-progress.service';
import { DownloadService } from '@/core/download/download.service';
import { HubReaderService } from '@/core/download/hub-reader.service';
import { NodeService } from '@/core/node/node.service';

import { DOWNLOAD_FILE_STATES, DOWNLOAD_PROGRESS_STATES } from './types/mappings';

const DEFAULT_REVISION = 'main';

const DOWNLOAD_STREAM_AUDIT_MS = 1000;

const MAX_SEARCH_LENGTH = 512;

@Injectable()
export class DownloadAdminService {
  private readonly logger = new Logger(DownloadAdminService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly downloadAdmissionService: DownloadAdmissionService,
    private readonly downloadService: DownloadService,
    private readonly downloadProgressService: DownloadProgressService,
    private readonly hubReaderService: HubReaderService,
    private readonly nodeService: NodeService
  ) {}

  async getDownloadList(request: DownloadListRequestDto, page: number): Promise<DownloadListResponseDto> {
    const pageSize = this.configService.pageSize;
    const search = this.searchOf(request.search);
    const [[downloads, total], counts] = await Promise.all([
      this.downloadService.findAndCount({ search, state: request.state }, pageSize * (page - 1), pageSize),
      this.downloadService.countByState(search),
    ]);

    return {
      downloadList: downloads.map(download => this.getIDownload(download)),
      pages: Math.ceil(total / pageSize),
      counts,
    };
  }

  /** Read from what nodes report, never from the rows, so it costs nothing however often it is sent. */
  getDownloadProgress(): DownloadProgressResponseDto {
    const byKey = new Map<string, DownloadTargetProgressDto[]>();

    for (const nodeId of this.downloadProgressService.nodeIds()) {
      for (const report of this.downloadProgressService.reportsFrom(nodeId)) {
        const targets = byKey.get(report.downloadKey) ?? [];

        targets.push({
          nodeId,
          progress: DOWNLOAD_PROGRESS_STATES[report.state],
          bytesDone: report.files.reduce((sum, file) => sum + file.bytesDone, 0),
          bytesPerSecond: this.downloadProgressService.bytesPerSecond(nodeId, report.downloadKey),
          files: report.files.map(file => ({
            path: file.path,
            state: DOWNLOAD_FILE_STATES[file.state],
            bytesDone: file.bytesDone,
          })),
        });
        byKey.set(report.downloadKey, targets);
      }
    }

    return { downloads: [...byKey].map(([key, targets]) => ({ key, targets })) };
  }

  /** Sends every node's progress on connect, then again at most once a second while nodes report. */
  watchDownloadProgress(): Observable<DownloadProgressResponseDto> {
    return concat(
      of(this.getDownloadProgress()),
      this.downloadProgressService.getProgressChanges().pipe(
        auditTime(DOWNLOAD_STREAM_AUDIT_MS),
        map(() => this.getDownloadProgress())
      )
    );
  }

  async getDownload(downloadId: number): Promise<DownloadDto> {
    return this.getIDownload(await this.downloadService.findWithThrow(downloadId));
  }

  async getRepositoryListing(request: RepositoryListingRequestDto): Promise<RepositoryListingResponseDto> {
    const listing = await this.hubReaderService.list(request.repository.trim(), this.revisionOf(request));

    return {
      repository: listing.repository,
      revision: listing.revision,
      files: listing.files.map(file => ({ path: file.path, sizeBytes: file.sizeBytes })),
      truncated: listing.truncated,
      maxFilesPerDownload: MAX_FILES_PER_DOWNLOAD,
    };
  }

  async createDownload(request: CreateDownloadRequestDto, actorId: number): Promise<DownloadDto> {
    const download = await this.downloadAdmissionService.create(
      {
        repository: request.repository.trim(),
        revision: this.revisionOf(request),
        directory: this.directoryOf(request),
        files: request.files,
        nodeIds: request.nodeIds,
      },
      actorId
    );

    return this.getIDownload(download);
  }

  stopDownload(downloadId: number, request: StopDownloadRequestDto, actorId: number): Promise<void> {
    return this.downloadService.stop(downloadId, request.nodeId ?? undefined, actorId);
  }

  retryDownload(downloadId: number, actorId: number): Promise<void> {
    return this.downloadAdmissionService.retry(downloadId, actorId);
  }

  dismissDownload(downloadId: number, actorId: number): Promise<void> {
    return this.downloadService.dismiss(downloadId, actorId);
  }

  private searchOf(search: string | undefined): string | undefined {
    const trimmed = search?.trim().slice(0, MAX_SEARCH_LENGTH) ?? '';

    return trimmed.length > 0 ? trimmed : undefined;
  }

  private directoryOf(request: CreateDownloadRequestDto): string {
    return request.directory.trim().replace(/\/+$/, '');
  }

  private revisionOf(request: { revision?: string }): string {
    const revision = request.revision?.trim() ?? '';

    return revision.length > 0 ? revision : DEFAULT_REVISION;
  }

  private getIDownload(download: Download): DownloadDto {
    const files = download.files ?? [];
    const targets = (download.targets ?? []).map(target => this.getIDownloadTarget(download, files, target));

    return {
      id: download.id,
      key: download.downloadKey,
      source: download.source,
      repository: download.repository,
      directory: download.directory,
      revision: download.revision,
      files: files.map(file => ({ path: file.path, sizeBytes: file.sizeBytes })),
      targets,
      state: this.downloadService.stateOf(download),
      bytesDone: targets.reduce((sum, target) => sum + target.bytesDone, 0),
      totalBytes: targets.reduce((sum, target) => sum + target.totalBytes, 0),
      createdByName: download.createdBy?.name,
      createdDate: download.createdDate,
    };
  }

  /** Progress comes from the node's last report, so only an active target on a connected node carries any. */
  private getIDownloadTarget(download: Download, files: DownloadFile[], target: DownloadTarget): DownloadTargetDto {
    if (target.node === undefined) {
      this.logger.error({ targetId: target.id }, 'getIDownloadTarget(): A download target was read without its node');

      throw new InternalServerErrorException();
    }

    const observed =
      target.state === DownloadTargetState.ACTIVE
        ? this.downloadProgressService.get(target.nodeId, download.downloadKey)
        : null;
    const targetFiles = files.map(file => this.getIDownloadTargetFile(file, target, observed));

    return {
      nodeId: target.nodeId,
      nodeName: target.node.name,
      nodeState: this.nodeService.getState(target.node),
      state: target.state,
      progress: observed === null ? null : DOWNLOAD_PROGRESS_STATES[observed.state],
      message: target.message,
      bytesDone: targetFiles.reduce((sum, file) => sum + file.bytesDone, 0),
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      bytesPerSecond:
        observed === null ? null : this.downloadProgressService.bytesPerSecond(target.nodeId, download.downloadKey),
      files: targetFiles,
      settledDate: target.settledDate ?? null,
    };
  }

  private getIDownloadTargetFile(
    file: DownloadFile,
    target: DownloadTarget,
    observed: ObservedDownload | null
  ): DownloadTargetFileDto {
    if (target.state === DownloadTargetState.SUCCEEDED) {
      return { path: file.path, state: DownloadFileState.DONE, bytesDone: file.sizeBytes };
    }

    const observedFile = observed?.files.find(entry => entry.path === file.path);

    return {
      path: file.path,
      state: observedFile === undefined ? null : DOWNLOAD_FILE_STATES[observedFile.state],
      bytesDone: observedFile?.bytesDone ?? 0,
    };
  }
}
