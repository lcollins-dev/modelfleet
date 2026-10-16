import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { In, Repository, SelectQueryBuilder } from 'typeorm';

import { DownloadState, DownloadTargetState, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { DownloadTarget } from './entities/download-target.entity';
import { Download } from './entities/download.entity';

import { EventService } from '../event/event.service';

const DOWNLOAD_MISSING_MESSAGE = 'This download does not exist';

/** The same reading `stateOf` makes, in SQL, so a page can be narrowed to one state. */
const STATE_SQL = `(
  SELECT CASE
    WHEN bool_or(target.state = 'active') THEN 'active'
    WHEN bool_or(target.state = 'failed') THEN 'failed'
    WHEN bool_and(target.state = 'succeeded') THEN 'completed'
    ELSE 'stopped'
  END
  FROM download_target target
  WHERE target."downloadId" = download.id
)`;

export interface IDownloadCriteria {
  search?: string;
  state?: DownloadState;
}

interface IStateCount {
  state: DownloadState;
  count: string;
}

/**
 * The downloads an operator reads and acts on, and the changes every other download service announces through it.
 * Starting one is `DownloadAdmissionService`'s; what nodes are asked for and report back is
 * `DownloadDesiredStateService`'s.
 */
@Injectable()
export class DownloadService {
  private readonly desiredChanged = new Subject<number>();
  private readonly rowsChanged = new Subject<void>();

  constructor(
    private readonly eventService: EventService,
    @InjectRepository(Download) private readonly downloadRepository: Repository<Download>,
    @InjectRepository(DownloadTarget) private readonly downloadTargetRepository: Repository<DownloadTarget>
  ) {}

  getDesiredDownloadChanges(): Observable<number> {
    return this.desiredChanged.asObservable();
  }

  /** Any download created, stopped, retried, settled or dismissed. */
  getDownloadChanges(): Observable<void> {
    return this.rowsChanged.asObservable();
  }

  /** Tells the wire which nodes' sets changed, and every reader that a row did. */
  announce(nodeIds: number[]): void {
    for (const nodeId of nodeIds) {
      this.desiredChanged.next(nodeId);
    }

    this.rowsChanged.next();
  }

  /** In progress anywhere, then failed anywhere, then succeeded everywhere; anything else was stopped. */
  stateOf(download: Download): DownloadState {
    const states = (download.targets ?? []).map(target => target.state);

    if (states.includes(DownloadTargetState.ACTIVE)) {
      return DownloadState.ACTIVE;
    }

    if (states.includes(DownloadTargetState.FAILED)) {
      return DownloadState.FAILED;
    }

    return states.every(state => state === DownloadTargetState.SUCCEEDED) && states.length > 0
      ? DownloadState.COMPLETED
      : DownloadState.STOPPED;
  }

  /**
   * Newest first, each carrying its files in order and its targets with their nodes. The relations are sorted here,
   * since ordering a paged query by a joined column pages over the joined rows rather than the downloads.
   */
  async findAndCount(criteria: IDownloadCriteria, skip: number, take: number): Promise<[Download[], number]> {
    const queryBuilder = this.downloadRepository
      .createQueryBuilder('download')
      .leftJoinAndSelect('download.files', 'file')
      .leftJoinAndSelect('download.targets', 'target')
      .leftJoinAndSelect('target.node', 'node')
      .leftJoinAndSelect('download.createdBy', 'createdBy');

    this.narrowToSearch(queryBuilder, criteria.search);

    if (criteria.state !== undefined) {
      queryBuilder.andWhere(`${STATE_SQL} = :state`, { state: criteria.state });
    }

    const [downloads, total] = await queryBuilder
      .orderBy('download.createdDate', 'DESC')
      .addOrderBy('download.id', 'DESC')
      .take(take)
      .skip(skip)
      .getManyAndCount();

    for (const download of downloads) {
      download.files?.sort((left, right) => left.position - right.position);
      download.targets?.sort((left, right) => (left.node?.name ?? '').localeCompare(right.node?.name ?? ''));
    }

    return [downloads, total];
  }

  /** Every state is present, at zero where nothing matches. */
  async countByState(search: string | undefined): Promise<Record<DownloadState, number>> {
    const queryBuilder = this.downloadRepository
      .createQueryBuilder('download')
      .select(STATE_SQL, 'state')
      .addSelect('COUNT(*)', 'count')
      .groupBy('state');

    this.narrowToSearch(queryBuilder, search);

    const rows = await queryBuilder.getRawMany<IStateCount>();
    const counts: Record<DownloadState, number> = {
      [DownloadState.ACTIVE]: 0,
      [DownloadState.FAILED]: 0,
      [DownloadState.STOPPED]: 0,
      [DownloadState.COMPLETED]: 0,
    };

    for (const row of rows) {
      counts[row.state] = parseInt(row.count, 10);
    }

    return counts;
  }

  async findWithThrow(downloadId: number): Promise<Download> {
    const download = await this.downloadRepository.findOne({
      where: { id: downloadId },
      relations: { files: true, targets: { node: true }, createdBy: true },
      order: { files: { position: 'ASC' }, targets: { node: { name: 'ASC' } } },
    });

    if (download === null) {
      throw new BadRequestException(DOWNLOAD_MISSING_MESSAGE);
    }

    return download;
  }

  /** Named by repository. A download that no longer exists is absent from the map, not an error. */
  async findNames(downloadIds: number[]): Promise<Map<number, string>> {
    if (downloadIds.length === 0) {
      return new Map();
    }

    const downloads = await this.downloadRepository.find({
      select: ['id', 'repository'],
      where: { id: In(downloadIds) },
    });

    return new Map(downloads.map(download => [download.id, download.repository]));
  }

  /** Stops every node still downloading where no node is named. What a node already finished stays on its disk. */
  async stop(downloadId: number, nodeId: number | undefined, actorId: number): Promise<void> {
    const download = await this.findWithThrow(downloadId);
    const stopping = (download.targets ?? []).filter(
      target => target.state === DownloadTargetState.ACTIVE && (nodeId === undefined || target.nodeId === nodeId)
    );

    if (stopping.length === 0) {
      throw new BadRequestException(
        nodeId === undefined
          ? 'This download is no longer in progress on any node'
          : 'This download is not in progress on that node'
      );
    }

    await this.downloadTargetRepository.update(
      { id: In(stopping.map(target => target.id)), state: DownloadTargetState.ACTIVE },
      { state: DownloadTargetState.STOPPED, settledDate: new Date() }
    );

    const nodes = stopping.map(target => target.node?.name ?? `${target.nodeId}`).join(', ');

    await this.eventService.recordEvent(EventType.DOWNLOAD_STOPPED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${download.id}`,
      message: `Stopped downloading **${download.repository}** to ${nodes}`,
      detail: { repository: download.repository, nodes },
    });

    this.announce(stopping.map(target => target.nodeId));
  }

  async dismiss(downloadId: number, actorId: number): Promise<void> {
    const download = await this.findWithThrow(downloadId);

    if ((download.targets ?? []).some(target => target.state === DownloadTargetState.ACTIVE)) {
      throw new BadRequestException('This download is still in progress, so stop it before dismissing it');
    }

    await this.downloadRepository.delete({ id: download.id });

    await this.eventService.recordEvent(EventType.DOWNLOAD_DISMISSED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DOWNLOAD,
      subjectId: `${download.id}`,
      message: `Dismissed the download of **${download.repository}**`,
      detail: { repository: download.repository },
    });

    this.announce([]);
  }

  private narrowToSearch(queryBuilder: SelectQueryBuilder<Download>, search: string | undefined): void {
    if (search !== undefined) {
      queryBuilder.andWhere('LOWER(download.repository) LIKE LOWER(:search)', { search: `%${search}%` });
    }
  }
}
