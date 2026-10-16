import { MessageEvent } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subject, Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventSeverity, EventPartyType, EventType, EventDto, EventFilterRequestDto } from '@libs/dto';

import { EventAdminService } from '@/api/v1/event/event-admin.service';

import { EventAdminController } from '@/api/v1/event/event-admin.controller';

const EVENT: EventDto = {
  id: 1,
  type: EventType.USER_SIGNED_IN,
  severity: EventSeverity.INFO,
  subjectType: EventPartyType.USER,
  subjectId: '7',
  detail: { email: 'tester@example.com' },
  createdDate: new Date('2026-08-22T10:00:00.000Z'),
};

describe('EventAdminController', () => {
  let controller: EventAdminController;
  let getEventListMock: ReturnType<typeof vi.fn>;
  let eventSubject: Subject<EventDto>;
  let subscription: Subscription | null = null;

  beforeEach(async () => {
    getEventListMock = vi.fn().mockResolvedValue({ eventList: [], pages: 0 });
    eventSubject = new Subject<EventDto>();

    const moduleRef = await Test.createTestingModule({
      controllers: [EventAdminController],
      providers: [
        {
          provide: EventAdminService,
          useValue: {
            getEventList: getEventListMock,
            getEventStream: () => eventSubject.asObservable(),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(EventAdminController);
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
  });

  it('passes the filter through to the service', async () => {
    const dto: EventFilterRequestDto = { severity: [EventSeverity.ERROR] };

    await controller.getEventList(dto, 2);

    expect(getEventListMock).toHaveBeenCalledWith(dto, 2);
  });

  it('streams a recorded event as a frame carrying it', () => {
    const seen: MessageEvent[] = [];
    subscription = controller.getEventStream().subscribe(frame => seen.push(frame));

    eventSubject.next(EVENT);

    expect(seen).toEqual([{ data: { ...EVENT } }]);
  });
});
