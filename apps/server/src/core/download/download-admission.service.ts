import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import {
  DOWNLOAD_REPOSITORY_PATTERN,
  MAX_DOWNLOAD_DIRECTORY_LENGTH,
  MAX_DOWNLOADS_PER_NODE,
  MAX_FILES_PER_DOWNLOAD,
  isContainedDownloadPath,
} from '@libs/agent-protocol';
import { DownloadSource, DownloadTargetState, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { DownloadFile } from './entities/download-file.entity';
import { DownloadTarget } from './entities/download-target.entity';
import { Download } from './entities/download.entity';

import { EventService } from '../event/event.service';
import { NodeService } from '../node/node.service';
import { DownloadService } from './download.service';
import { HubReaderService, IHubSnapshot } from './hub-reader.service';

export interface IDownloadDefinition {
  repository: string;
  directory: string;

  revision: string;
  files: string[];
  nodeIds: number[];
}

/** Where a file lands under the model directory, which is what two downloads must not share. */
const LANDED_PATH_SQL = `download.directory || '/' || file.path`;

const RETRYABLE_STATES: DownloadTargetState[] = [DownloadTargetState.FAILED, DownloadTargetState.STOPPED];

interface IFileOnNode {
  path: string;
  nodeId: number;
}

/** Asking nodes for files, the first time and again after a failure, and every check that asking must pass. */
@Injectable()
export class DownloadAdmissionService {
  constructor(
    private readonly downloadService: DownloadService,
    private readonly eventService: EventService,
    private readonly hubReaderService: HubReaderService,
    private readonly nodeService: NodeService,
    @InjectRepository(Download) private readonly downloadRepository: Repository<Download>,
    @InjectRepository(DownloadFile) private readonly downloadFileRepository: Repository<DownloadFile>,
    @InjectRepository(DownloadTarget) private readonly downloadTargetRepository: Repository<DownloadTarget>
  ) {}

  /** Reads the repository first, so nothing is written for a repository, revision or file the Hub refuses. */
  async create(definition: IDownloadDefinition, actorId: number): Promise<Download> {
    const paths = [...new Set(definition.files.map(path => path.trim()).filter(path => path.length > 0))];

    this.checkDefinition(definition, paths);

    const nodeIds = [...new Set(definition.nodeIds)];

    for (const nodeId of nodeIds) {
      await this.nodeService.findWithThrow(nodeId);
    }

    const snapshot = await this.hubReaderService.read(definition.repository, definition.revision, paths);
    const download = await this.insert(snapshot, definition.directory, nodeIds, actorId);

    this.downloadService.announce(nodeIds);

    return this.downloadService.findWithThrow(download.id);
  }

  /**
   * Asks every node the download failed or was stopped on to try again, at the same commit and for the same files, without reading
   * the Hub again. The node reports each file it finished as held and fetches the rest.
   */
  async retry(downloadId: number, actorId: number): Promise<void> {
    this.downloadService.announce(await this.writeRetry(downloadId, actorId));
  }

  /** Returns the nodes to announce, which waits for the commit so the publisher reads the retried targets. */
  @Transactional()
  private async writeRetry(downloadId: number, actorId: number): Promise<number[]> {
    const download = await this.downloadService.findWithThrow(downloadId);
    const retrying = (download.targets ?? []).filter(target => RETRYABLE_STATES.includes(target.state));

    if (retrying.length === 0) {
      throw new BadRequestException('This download has not failed or been stopped on any node');
    }

    await this.checkNodesCanTake(
      download.directory,
      (download.files ?? []).map(file => file.path),
      retrying.map(target => target.nodeId)
    );

    await this.downloadTargetRepository.update(
      { id: In(retrying.map(target => target.id)), state: In(RETRYABLE_STATES) },
      { state: DownloadTargetState.ACTIVE, attempt: () => '"attempt" + 1', message: null, settledDate: null }
    );

    const nodes = retrying.map(target => target.node?.name ?? `${target.nodeId}`).join(', ');

    await this.eventService.recordEvent(EventType.DOWNLOAD_RETRIED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${download.id}`,
      message: `Retried downloading **${download.repository}** to ${nodes}`,
      detail: { repository: download.repository, nodes },
    });

    return retrying.map(target => target.nodeId);
  }

  private checkDefinition(definition: IDownloadDefinition, paths: string[]): void {
    if (!DOWNLOAD_REPOSITORY_PATTERN.test(definition.repository)) {
      throw new BadRequestException('A repository is named as owner/name');
    }

    if (definition.directory.length > MAX_DOWNLOAD_DIRECTORY_LENGTH || !isContainedDownloadPath(definition.directory)) {
      throw new BadRequestException('A destination is a path inside the model directory, with no empty, . or .. part');
    }

    if (paths.length === 0 || paths.length > MAX_FILES_PER_DOWNLOAD) {
      throw new BadRequestException(`A download names between 1 and ${MAX_FILES_PER_DOWNLOAD} files`);
    }

    const refused = paths.filter(path => !isContainedDownloadPath(path));

    if (refused.length > 0) {
      throw new BadRequestException(`${refused.join(', ')} cannot be downloaded to a node under that name`);
    }

    if (definition.nodeIds.length === 0) {
      throw new BadRequestException('A download names at least one node');
    }
  }

  @Transactional()
  private async insert(
    snapshot: IHubSnapshot,
    directory: string,
    nodeIds: number[],
    actorId: number
  ): Promise<Download> {
    await this.checkNodesCanTake(
      directory,
      snapshot.files.map(file => file.path),
      nodeIds
    );

    const download = new Download({
      source: DownloadSource.HUGGINGFACE,
      repository: snapshot.repository,
      directory,
      revision: snapshot.revision,
      createdById: actorId,
    });

    await this.downloadRepository.insert(download);

    await this.downloadFileRepository.insert(
      snapshot.files.map((file, position) => new DownloadFile({ downloadId: download.id, position, ...file }))
    );

    await this.downloadTargetRepository.insert(
      nodeIds.map(nodeId => new DownloadTarget({ downloadId: download.id, nodeId }))
    );

    const nodeNames = await this.nodeService.findNames(nodeIds);
    const nodes = nodeIds.map(nodeId => nodeNames.get(nodeId) ?? `${nodeId}`).join(', ');

    await this.eventService.recordEvent(EventType.DOWNLOAD_REQUESTED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${download.id}`,
      message: `Started downloading **${download.repository}** to ${nodes}`,
      detail: { repository: download.repository, revision: download.revision, files: snapshot.files.length, nodes },
    });

    return download;
  }

  /** Two downloads landing a file at one path on one node would share its partial, whatever each is downloading. */
  private async checkNodesCanTake(directory: string, paths: string[], nodeIds: number[]): Promise<void> {
    // Serialises creates that share a node until this transaction ends, so two cannot both pass the checks below.
    await this.downloadTargetRepository.query('SELECT "id" FROM "node" WHERE "id" = ANY($1) ORDER BY "id" FOR UPDATE', [
      nodeIds,
    ]);

    const busy = await this.downloadFileRepository
      .createQueryBuilder('file')
      .innerJoin('file.download', 'download')
      .innerJoin('download.targets', 'target')
      .select(LANDED_PATH_SQL, 'path')
      .addSelect('target.nodeId', 'nodeId')
      .where('target.state = :state', { state: DownloadTargetState.ACTIVE })
      .andWhere('target.nodeId IN (:...nodeIds)', { nodeIds })
      .andWhere(`${LANDED_PATH_SQL} IN (:...landed)`, { landed: paths.map(path => `${directory}/${path}`) })
      .getRawMany<IFileOnNode>();

    if (busy.length > 0) {
      const names = await this.nodeService.findNames(busy.map(entry => entry.nodeId));
      const clashes = busy.map(entry => `${entry.path} on ${names.get(entry.nodeId) ?? entry.nodeId}`).join(', ');

      throw new BadRequestException(`Another download is already writing ${clashes}`);
    }

    const full = await this.downloadTargetRepository
      .createQueryBuilder('target')
      .select('target.nodeId', 'nodeId')
      .where('target.state = :state', { state: DownloadTargetState.ACTIVE })
      .andWhere('target.nodeId IN (:...nodeIds)', { nodeIds })
      .groupBy('target.nodeId')
      .having('COUNT(*) >= :cap', { cap: MAX_DOWNLOADS_PER_NODE })
      .getRawMany<{ nodeId: number }>();

    if (full.length > 0) {
      const names = await this.nodeService.findNames(full.map(entry => entry.nodeId));
      const nodes = full.map(entry => names.get(entry.nodeId) ?? `${entry.nodeId}`).join(', ');

      throw new BadRequestException(`${nodes} already has ${MAX_DOWNLOADS_PER_NODE} downloads in progress`);
    }
  }
}
