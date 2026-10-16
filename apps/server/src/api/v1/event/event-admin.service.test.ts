import { Test } from '@nestjs/testing';
import { Subject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Event } from '@/core/event/entities/event.entity';

import { EventAdminService } from '@/api/v1/event/event-admin.service';
import { ConfigService } from '@/config/config.service';
import { ApiKeyService } from '@/core/api-key/api-key.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { DownloadService } from '@/core/download/download.service';
import { EventService } from '@/core/event/event.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';
import { PresetService } from '@/core/preset/preset.service';
import { UserService } from '@/core/user/user.service';

const PAGE_SIZE = 3;

const buildNodeEvent = (id: number): Event => {
  const event = new Event({
    type: EventType.NODE_CONNECTED,
    severity: EventSeverity.INFO,
    actorType: null,
    actorId: null,
    subjectType: EventPartyType.NODE,
    subjectId: '4',
    message: 'Node **rig-01** connected from `192.0.2.4`',
    detail: { name: 'rig-01' },
  });
  event.id = id;
  event.createdDate = new Date('2026-08-22T10:00:00.000Z');

  return event;
};

const buildModelEvent = (id: number): Event => {
  const event = new Event({
    type: EventType.MODEL_AVAILABILITY_REMOVED,
    severity: EventSeverity.WARNING,
    actorType: EventPartyType.NODE,
    actorId: '4',
    subjectType: EventPartyType.MODEL,
    subjectId: '9',
    message: 'Node **rig-01** no longer holds model **Llama 3 8B**',
    detail: { name: 'Llama 3 8B', fingerprint: 'a'.repeat(64), path: '/models/llama.gguf' },
  });
  event.id = id;
  event.createdDate = new Date('2026-08-22T10:00:00.000Z');

  return event;
};

const buildEvent = (id: number): Event => {
  const event = new Event({
    type: EventType.USER_SIGNED_IN,
    severity: EventSeverity.INFO,
    actorType: EventPartyType.USER,
    actorId: '7',
    subjectType: EventPartyType.USER,
    subjectId: '7',
    message: '**Ada Whitfield** signed in as `tester@example.com`',
    detail: { email: 'tester@example.com' },
  });
  event.id = id;
  event.createdDate = new Date('2026-08-22T10:00:00.000Z');

  return event;
};

describe('EventAdminService', () => {
  let eventAdminService: EventAdminService;
  let recorded: Subject<Event>;
  let findAndCountMock: ReturnType<typeof vi.fn>;
  let userService: { findNames: ReturnType<typeof vi.fn> };
  let nodeService: { findNames: ReturnType<typeof vi.fn> };
  let modelService: { findNames: ReturnType<typeof vi.fn> };
  let presetService: { findNames: ReturnType<typeof vi.fn> };
  let deploymentService: { findNames: ReturnType<typeof vi.fn> };
  let apiKeyService: { findNames: ReturnType<typeof vi.fn> };
  let downloadService: { findNames: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    recorded = new Subject<Event>();
    findAndCountMock = vi.fn().mockResolvedValue([[], 0]);
    userService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    nodeService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    modelService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    presetService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    deploymentService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    apiKeyService = { findNames: vi.fn().mockResolvedValue(new Map()) };
    downloadService = { findNames: vi.fn().mockResolvedValue(new Map()) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EventAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        {
          provide: EventService,
          useValue: { findAndCount: findAndCountMock, eventRecorded: () => recorded.asObservable() },
        },
        { provide: UserService, useValue: userService },
        { provide: NodeService, useValue: nodeService },
        { provide: ModelService, useValue: modelService },
        { provide: PresetService, useValue: presetService },
        { provide: DeploymentService, useValue: deploymentService },
        { provide: ApiKeyService, useValue: apiKeyService },
        { provide: DownloadService, useValue: downloadService },
      ],
    }).compile();

    eventAdminService = moduleRef.get(EventAdminService);
  });

  describe('getEventList', () => {
    it('turns the requested page into an offset and a limit', async () => {
      await eventAdminService.getEventList({}, 3);

      expect(findAndCountMock).toHaveBeenCalledWith(expect.anything(), PAGE_SIZE * 2, PAGE_SIZE);
    });

    it('reads the filter dates as dates', async () => {
      await eventAdminService.getEventList({ fromDate: '2026-08-01T00:00:00.000Z' }, 1);

      const [criteria] = findAndCountMock.mock.calls[0] as [{ fromDate?: Date; toDate?: Date }];

      expect(criteria.fromDate).toEqual(new Date('2026-08-01T00:00:00.000Z'));
      expect(criteria.toDate).toBeUndefined();
    });

    it('reports how many pages the filtered log holds', async () => {
      findAndCountMock.mockResolvedValue([[buildEvent(2), buildEvent(1)], 7]);

      const response = await eventAdminService.getEventList({}, 1);

      expect(response.eventList).toHaveLength(2);
      expect(response.pages).toBe(3);
    });

    it('reports no pages for a filter nothing matches', async () => {
      const response = await eventAdminService.getEventList({}, 1);

      expect(response.pages).toBe(0);
    });

    it('carries the message the row was recorded with', async () => {
      findAndCountMock.mockResolvedValue([[buildEvent(1)], 1]);

      const response = await eventAdminService.getEventList({}, 1);

      expect(response.eventList[0].message).toBe('**Ada Whitfield** signed in as `tester@example.com`');
    });

    it('reads a row with no message as one carrying none', async () => {
      const event = buildEvent(1);
      event.message = null;
      findAndCountMock.mockResolvedValue([[event], 1]);

      const response = await eventAdminService.getEventList({}, 1);

      expect(response.eventList[0].message).toBeUndefined();
    });

    it('reads a row with no actor as one carrying none', async () => {
      const event = buildEvent(1);
      event.actorType = null;
      event.actorId = null;
      findAndCountMock.mockResolvedValue([[event], 1]);

      const response = await eventAdminService.getEventList({}, 1);

      expect(response.eventList[0].actorType).toBeUndefined();
      expect(response.eventList[0].actorId).toBeUndefined();
    });

    it('names the user an event acted as and on', async () => {
      findAndCountMock.mockResolvedValue([[buildEvent(1)], 1]);
      userService.findNames.mockResolvedValue(new Map([[7, 'Ada Whitfield']]));

      const response = await eventAdminService.getEventList({}, 1);

      expect(userService.findNames).toHaveBeenCalledWith([7, 7]);
      expect(response.eventList[0].actorName).toBe('Ada Whitfield');
      expect(response.eventList[0].subjectName).toBe('Ada Whitfield');
    });

    it('names the node an event was recorded against', async () => {
      findAndCountMock.mockResolvedValue([[buildNodeEvent(1)], 1]);
      nodeService.findNames.mockResolvedValue(new Map([[4, 'rig-01']]));

      const response = await eventAdminService.getEventList({}, 1);

      expect(nodeService.findNames).toHaveBeenCalledWith([4]);
      expect(response.eventList[0].subjectName).toBe('rig-01');
      expect(response.eventList[0].actorName).toBeUndefined();
    });

    it('names the model an event was recorded against', async () => {
      findAndCountMock.mockResolvedValue([[buildModelEvent(1)], 1]);
      nodeService.findNames.mockResolvedValue(new Map([[4, 'rig-01']]));
      modelService.findNames.mockResolvedValue(new Map([[9, 'Llama 3 8B']]));

      const response = await eventAdminService.getEventList({}, 1);

      expect(modelService.findNames).toHaveBeenCalledWith([9]);
      expect(response.eventList[0].subjectName).toBe('Llama 3 8B');
      expect(response.eventList[0].actorName).toBe('rig-01');
    });

    it('names a download by its repository', async () => {
      const event = new Event({
        type: EventType.DOWNLOAD_DISMISSED,
        severity: EventSeverity.INFO,
        actorType: null,
        actorId: null,
        subjectType: EventPartyType.DOWNLOAD,
        subjectId: '3',
        message: null,
        detail: { repository: 'unsloth/Qwen3-0.6B-GGUF' },
      });
      event.id = 1;
      event.createdDate = new Date('2026-08-22T10:00:00.000Z');

      findAndCountMock.mockResolvedValue([[event], 1]);
      downloadService.findNames.mockResolvedValue(new Map([[3, 'unsloth/Qwen3-0.6B-GGUF']]));

      const response = await eventAdminService.getEventList({}, 1);

      expect(downloadService.findNames).toHaveBeenCalledWith([3]);
      expect(response.eventList[0].subjectName).toBe('unsloth/Qwen3-0.6B-GGUF');
    });

    it('leaves a party that no longer exists unnamed', async () => {
      findAndCountMock.mockResolvedValue([[buildEvent(1)], 1]);

      const response = await eventAdminService.getEventList({}, 1);

      expect(response.eventList[0].actorName).toBeUndefined();
      expect(response.eventList[0].actorId).toBe('7');
    });

    it('asks for no parties on a page holding none', async () => {
      await eventAdminService.getEventList({}, 1);

      expect(userService.findNames).toHaveBeenCalledWith([]);
      expect(nodeService.findNames).toHaveBeenCalledWith([]);
    });
  });

  describe('getEventStream', () => {
    it('carries a recorded event through as a response event', async () => {
      const streamed = firstValueFrom(eventAdminService.getEventStream());

      recorded.next(buildEvent(1));

      const event = await streamed;

      expect(event.id).toBe(1);
      expect(event.type).toBe(EventType.USER_SIGNED_IN);
      expect(event.actorId).toBe('7');
      expect(event.subjectId).toBe('7');
    });

    it('names the parties on the event it streams', async () => {
      userService.findNames.mockResolvedValue(new Map([[7, 'Ada Whitfield']]));

      const streamed = firstValueFrom(eventAdminService.getEventStream());

      recorded.next(buildEvent(1));

      const event = await streamed;

      expect(event.actorName).toBe('Ada Whitfield');
      expect(event.subjectName).toBe('Ada Whitfield');
    });
  });
});
