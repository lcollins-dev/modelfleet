import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import {
  DOWNLOAD_REPOSITORY_PATTERN,
  MAX_DOWNLOAD_DIRECTORY_LENGTH,
  MAX_DOWNLOADS_PER_NODE,
  MAX_FILES_PER_DOWNLOAD,
  MAX_MODEL_PATH_LENGTH,
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

  /** A node left out lands the files in its first model directory. */
  modelDirectories: IModelDirectoryChoice[];
}

export interface IModelDirectoryChoice {
  nodeId: number;
  path: string;
}

/** Null reads as the node's first model directory. */
interface ITargetPlacement {
  nodeId: number;
  modelDirectory: string | null;
}

/** Where a file lands under the model directory, which is what two downloads must not share. */
const LANDED_PATH_SQL = `download.directory || '/' || file.path`;

const RETRYABLE_STATES: DownloadTargetState[] = [DownloadTargetState.FAILED, DownloadTargetState.STOPPED];

interface IFileOnNode {
  path: string;
  nodeId: number;
  modelDirectory: string | null;
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

    const placements = nodeIds.map(nodeId => ({
      nodeId,
      modelDirectory: definition.modelDirectories.find(choice => choice.nodeId === nodeId)?.path ?? null,
    }));

    const snapshot = await this.hubReaderService.read(definition.repository, definition.revision, paths);
    const download = await this.insert(snapshot, definition.directory, placements, actorId);

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
      throw new BadRequestException('Only failed or cancelled downloads can be retried');
    }

    await this.checkNodesCanTake(
      download.directory,
      (download.files ?? []).map(file => file.path),
      retrying.map(target => ({ nodeId: target.nodeId, modelDirectory: target.modelDirectory }))
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
      throw new BadRequestException('Enter the repository as owner/name');
    }

    if (definition.directory.length > MAX_DOWNLOAD_DIRECTORY_LENGTH || !isContainedDownloadPath(definition.directory)) {
      throw new BadRequestException(
        'Enter a path within the model directory. Each part must be a folder name, not empty, . or ..'
      );
    }

    if (paths.length === 0 || paths.length > MAX_FILES_PER_DOWNLOAD) {
      throw new BadRequestException(`Select between 1 and ${MAX_FILES_PER_DOWNLOAD} files per download`);
    }

    const refused = paths.filter(path => !isContainedDownloadPath(path));

    if (refused.length > 0) {
      throw new BadRequestException(`${refused.join(', ')} cannot be downloaded to a node under that name`);
    }

    if (definition.nodeIds.length === 0) {
      throw new BadRequestException('Select at least one node');
    }

    this.checkModelDirectories(definition);
  }

  /** Which directories a node has is the node's to check, since only it knows its own configuration. */
  private checkModelDirectories(definition: IDownloadDefinition): void {
    const chosen = definition.modelDirectories.map(choice => choice.nodeId);

    if (chosen.some(nodeId => !definition.nodeIds.includes(nodeId))) {
      throw new BadRequestException('Select a model directory only for nodes included in this download.');
    }

    if (new Set(chosen).size !== chosen.length) {
      throw new BadRequestException('Select only one model directory per node.');
    }

    if (definition.modelDirectories.some(choice => !this.isModelDirectoryPath(choice.path))) {
      throw new BadRequestException(
        `Model directory paths must be non-empty, at most ${MAX_MODEL_PATH_LENGTH} characters long, and contain no null characters.`
      );
    }
  }

  /**
   * Postgres refuses a NUL in text, and the desired set measures length in UTF-16 units where the request counts code
   * points, so a longer one would make the node's whole set unsendable.
   */
  private isModelDirectoryPath(path: string): boolean {
    return path.trim().length > 0 && path.length <= MAX_MODEL_PATH_LENGTH && !path.includes('\0');
  }

  @Transactional()
  private async insert(
    snapshot: IHubSnapshot,
    directory: string,
    placements: ITargetPlacement[],
    actorId: number
  ): Promise<Download> {
    const nodeIds = placements.map(placement => placement.nodeId);

    await this.checkNodesCanTake(
      directory,
      snapshot.files.map(file => file.path),
      placements
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
      placements.map(placement => new DownloadTarget({ downloadId: download.id, ...placement }))
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

  /**
   * Two downloads landing a file at one path in one model directory on one node would share its partial, whatever each
   * is downloading. A target naming no directory is taken to share whichever the other names, since only the node knows
   * which is its first.
   */
  private async checkNodesCanTake(directory: string, paths: string[], placements: ITargetPlacement[]): Promise<void> {
    const nodeIds = placements.map(placement => placement.nodeId);

    // Serialises creates that share a node until this transaction ends, so two cannot both pass the checks below.
    await this.downloadTargetRepository.query('SELECT "id" FROM "node" WHERE "id" = ANY($1) ORDER BY "id" FOR UPDATE', [
      nodeIds,
    ]);

    const landed = await this.downloadFileRepository
      .createQueryBuilder('file')
      .innerJoin('file.download', 'download')
      .innerJoin('download.targets', 'target')
      .select(LANDED_PATH_SQL, 'path')
      .addSelect('target.nodeId', 'nodeId')
      .addSelect('target.modelDirectory', 'modelDirectory')
      .where('target.state = :state', { state: DownloadTargetState.ACTIVE })
      .andWhere('target.nodeId IN (:...nodeIds)', { nodeIds })
      .andWhere(`${LANDED_PATH_SQL} IN (:...landed)`, { landed: paths.map(path => `${directory}/${path}`) })
      .getRawMany<IFileOnNode>();
    const busy = landed.filter(entry => this.sharesModelDirectory(entry, placements));

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

  private sharesModelDirectory(entry: IFileOnNode, placements: ITargetPlacement[]): boolean {
    const placement = placements.find(candidate => candidate.nodeId === entry.nodeId);

    if (placement === undefined) {
      return false;
    }

    return (
      entry.modelDirectory === null ||
      placement.modelDirectory === null ||
      entry.modelDirectory === placement.modelDirectory
    );
  }
}
