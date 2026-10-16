import { Injectable } from '@nestjs/common';
import { Observable, concatMap } from 'rxjs';

import { EventPartyType, EventDto, EventFilterRequestDto, EventListResponseDto } from '@libs/dto';

import { Event } from '@/core/event/entities/event.entity';

import { ConfigService } from '@/config/config.service';
import { ApiKeyService } from '@/core/api-key/api-key.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { DownloadService } from '@/core/download/download.service';
import { EventService } from '@/core/event/event.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';
import { PresetService } from '@/core/preset/preset.service';
import { UserService } from '@/core/user/user.service';

@Injectable()
export class EventAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly userService: UserService,
    private readonly nodeService: NodeService,
    private readonly modelService: ModelService,
    private readonly presetService: PresetService,
    private readonly deploymentService: DeploymentService,
    private readonly apiKeyService: ApiKeyService,
    private readonly downloadService: DownloadService
  ) {}

  async getEventList(eventFilterRequest: EventFilterRequestDto, page: number): Promise<EventListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [events, total] = await this.eventService.findAndCount(
      {
        type: eventFilterRequest.type,
        severity: eventFilterRequest.severity,
        actorType: eventFilterRequest.actorType,
        actorId: eventFilterRequest.actorId,
        subjectType: eventFilterRequest.subjectType,
        subjectId: eventFilterRequest.subjectId,
        fromDate: eventFilterRequest.fromDate === undefined ? undefined : new Date(eventFilterRequest.fromDate),
        toDate: eventFilterRequest.toDate === undefined ? undefined : new Date(eventFilterRequest.toDate),
      },
      pageSize * (page - 1),
      pageSize
    );

    const partyNames = await this.getPartyNames(events);

    return {
      eventList: events.map(event => this.getIEvent(event, partyNames)),
      pages: Math.ceil(total / pageSize),
    };
  }

  getEventStream(): Observable<EventDto> {
    return this.eventService
      .eventRecorded()
      .pipe(concatMap(async event => this.getIEvent(event, await this.getPartyNames([event]))));
  }

  private getIEvent(event: Event, partyNames: Map<string, string>): EventDto {
    return {
      id: event.id,
      type: event.type,
      severity: event.severity,
      actorType: event.actorType ?? undefined,
      actorId: event.actorId ?? undefined,
      actorName: partyNames.get(this.getPartyKey(event.actorType, event.actorId)),
      subjectType: event.subjectType ?? undefined,
      subjectId: event.subjectId ?? undefined,
      subjectName: partyNames.get(this.getPartyKey(event.subjectType, event.subjectId)),
      message: event.message ?? undefined,
      detail: event.detail,
      createdDate: event.createdDate,
    };
  }

  /** Keyed by `getPartyKey`, and holding only the parties that still exist. */
  private async getPartyNames(events: Event[]): Promise<Map<string, string>> {
    const partyIds: Record<EventPartyType, number[]> = {
      [EventPartyType.USER]: [],
      [EventPartyType.NODE]: [],
      [EventPartyType.MODEL]: [],
      [EventPartyType.PRESET]: [],
      [EventPartyType.DEPLOYMENT]: [],
      [EventPartyType.API_KEY]: [],
      [EventPartyType.DOWNLOAD]: [],
    };

    for (const event of events) {
      this.collectPartyId(event.actorType, event.actorId, partyIds);
      this.collectPartyId(event.subjectType, event.subjectId, partyIds);
    }

    const [userNames, nodeNames, modelNames, presetNames, deploymentNames, apiKeyNames, downloadNames] =
      await Promise.all([
        this.userService.findNames(partyIds[EventPartyType.USER]),
        this.nodeService.findNames(partyIds[EventPartyType.NODE]),
        this.modelService.findNames(partyIds[EventPartyType.MODEL]),
        this.presetService.findNames(partyIds[EventPartyType.PRESET]),
        this.deploymentService.findNames(partyIds[EventPartyType.DEPLOYMENT]),
        this.apiKeyService.findNames(partyIds[EventPartyType.API_KEY]),
        this.downloadService.findNames(partyIds[EventPartyType.DOWNLOAD]),
      ]);

    const namesByPartyType: [EventPartyType, Map<number, string>][] = [
      [EventPartyType.USER, userNames],
      [EventPartyType.NODE, nodeNames],
      [EventPartyType.MODEL, modelNames],
      [EventPartyType.PRESET, presetNames],
      [EventPartyType.DEPLOYMENT, deploymentNames],
      [EventPartyType.API_KEY, apiKeyNames],
      [EventPartyType.DOWNLOAD, downloadNames],
    ];

    const partyNames = new Map<string, string>();

    for (const [partyType, names] of namesByPartyType) {
      for (const [rowId, name] of names) {
        partyNames.set(this.getPartyKey(partyType, `${rowId}`), name);
      }
    }

    return partyNames;
  }

  /** Appends the party's row id to the list its kind is read from. */
  private collectPartyId(
    partyType: EventPartyType | null,
    partyId: string | null,
    partyIds: Record<EventPartyType, number[]>
  ): void {
    if (partyType === null || partyId === null) {
      return;
    }

    const rowId = parseInt(partyId, 10);

    if (isNaN(rowId)) {
      return;
    }

    partyIds[partyType].push(rowId);
  }

  private getPartyKey(partyType: EventPartyType | null, partyId: string | null): string {
    return `${partyType}:${partyId}`;
  }
}
