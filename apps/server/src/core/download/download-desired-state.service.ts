import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { DesiredDownload, MAX_DOWNLOADS_PER_NODE } from '@libs/agent-protocol';
import { DownloadTargetState, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { DownloadTarget } from './entities/download-target.entity';
import { Download } from './entities/download.entity';

import { EventService } from '../event/event.service';
import { DownloadService } from './download.service';
import { HubReaderService } from './hub-reader.service';
import { ConfigService } from '@/config/config.service';

export type DownloadOutcome = DownloadTargetState.SUCCEEDED | DownloadTargetState.FAILED;

export interface IDownloadReport {
  nodeId: number;
  downloadKey: string;
  attempt: number;
  message: string | null;
}

/** The node's side: the set each node is asked to work on, and the outcome each reports back. */
@Injectable()
export class DownloadDesiredStateService {
  constructor(
    private readonly configService: ConfigService,
    private readonly downloadService: DownloadService,
    private readonly eventService: EventService,
    private readonly hubReaderService: HubReaderService,
    @InjectRepository(Download) private readonly downloadRepository: Repository<Download>,
    @InjectRepository(DownloadTarget) private readonly downloadTargetRepository: Repository<DownloadTarget>
  ) {}

  /**
   * Oldest first, which is the order the node works through them, and never more than a set can carry: a download
   * past the cap waits for an earlier one to settle rather than making the whole set unsendable.
   */
  async findDesired(nodeId: number): Promise<DesiredDownload[]> {
    const downloads = await this.downloadRepository
      .createQueryBuilder('download')
      .innerJoinAndSelect('download.targets', 'target', 'target.nodeId = :nodeId AND target.state = :state', {
        nodeId,
        state: DownloadTargetState.ACTIVE,
      })
      .leftJoinAndSelect('download.files', 'file')
      .orderBy('download.createdDate', 'ASC')
      .addOrderBy('download.id', 'ASC')
      .addOrderBy('file.position', 'ASC')
      .getMany();

    return downloads.slice(0, MAX_DOWNLOADS_PER_NODE).map(download => ({
      downloadKey: download.downloadKey,
      attempt: download.targets?.[0]?.attempt ?? 0,
      source: download.source,
      endpoint: this.configService.huggingfaceEndpoint,
      repository: download.repository,
      directory: download.directory,
      revision: download.revision,
      files: (download.files ?? []).map(file => ({
        path: file.path,
        url: this.hubReaderService.fileUrl(download.repository, download.revision, file.path),
        sizeBytes: file.sizeBytes,
        digest: { algorithm: file.digestAlgorithm, value: file.digest },
      })),
      token: this.configService.huggingfaceToken ?? undefined,
    }));
  }

  /**
   * A report about a download this node is no longer asked for, stopped, already settled or from an earlier attempt,
   * changes nothing.
   */
  async settle(report: IDownloadReport, outcome: DownloadOutcome): Promise<void> {
    if (await this.writeSettled(report, outcome)) {
      this.downloadService.announce([report.nodeId]);
    }
  }

  /** Rolls the outcome back where its event fails, so the node's next report settles it again. */
  @Transactional()
  private async writeSettled(report: IDownloadReport, outcome: DownloadOutcome): Promise<boolean> {
    const { nodeId, downloadKey, attempt, message } = report;
    const target = await this.downloadTargetRepository.findOne({
      where: { nodeId, attempt, state: DownloadTargetState.ACTIVE, download: { downloadKey } },
      relations: { download: true, node: true },
    });

    if (target?.download === undefined || target.node === undefined) {
      return false;
    }

    const result = await this.downloadTargetRepository.update(
      { id: target.id, attempt, state: DownloadTargetState.ACTIVE },
      { state: outcome, message: outcome === DownloadTargetState.FAILED ? message : null, settledDate: new Date() }
    );

    if (result.affected === 0) {
      return false;
    }

    await this.recordSettled(target.download, target.node.name, outcome, message);

    return true;
  }

  private async recordSettled(
    download: Download,
    nodeName: string,
    outcome: DownloadOutcome,
    message: string | null
  ): Promise<void> {
    const subject = { subjectType: EventPartyType.DOWNLOAD, subjectId: `${download.id}` };

    if (outcome === DownloadTargetState.SUCCEEDED) {
      await this.eventService.recordEvent(EventType.DOWNLOAD_SUCCEEDED, EventSeverity.INFO, {
        ...subject,
        message: `Downloaded **${download.repository}** to ${nodeName}`,
        detail: { repository: download.repository, nodeName },
      });

      return;
    }

    const problem = message ?? 'The node gave no reason';

    await this.eventService.recordEvent(EventType.DOWNLOAD_FAILED, EventSeverity.ERROR, {
      ...subject,
      message: `Downloading **${download.repository}** to ${nodeName} failed: ${problem}`,
      detail: { repository: download.repository, nodeName, problem },
    });
  }
}
