import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Event } from '@/core/event/entities/event.entity';

import { EventService } from '@/core/event/event.service';

const PAGE_SIZE = 3;

const buildEvent = (id: number): Event => {
  const event = new Event({
    type: EventType.USER_SIGNED_IN,
    severity: EventSeverity.INFO,
    actorType: EventPartyType.USER,
    actorId: '7',
    subjectType: EventPartyType.USER,
    subjectId: '7',
    message: '**Tester** signed in as `tester@example.com`',
    detail: { email: 'tester@example.com' },
  });
  event.id = id;
  event.createdDate = new Date('2026-08-22T10:00:00.000Z');

  return event;
};

describe('EventService', () => {
  let eventService: EventService;
  let queryBuilder: {
    andWhere: ReturnType<typeof vi.fn>;
    orderBy: ReturnType<typeof vi.fn>;
    take: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn>;
    getManyAndCount: ReturnType<typeof vi.fn>;
  };
  let eventRepository: { insert: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    queryBuilder = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
    };

    eventRepository = {
      insert: vi.fn(event => {
        Object.assign(event, { id: 1, createdDate: new Date() });

        return Promise.resolve({ identifiers: [{ id: 1 }] });
      }),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [EventService, { provide: getRepositoryToken(Event), useValue: eventRepository }],
    }).compile();

    eventService = moduleRef.get(EventService);
  });

  describe('recordEvent', () => {
    it('appends an event carrying its actor, subject, message and detail', async () => {
      await eventService.recordEvent(EventType.USER_SIGNED_IN, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: '7',
        subjectType: EventPartyType.USER,
        subjectId: '7',
        message: '**Tester** signed in',
        detail: { email: 'tester@example.com' },
      });

      expect(eventRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.USER_SIGNED_IN,
          severity: EventSeverity.INFO,
          actorType: EventPartyType.USER,
          actorId: '7',
          subjectType: EventPartyType.USER,
          subjectId: '7',
          message: '**Tester** signed in',
          detail: { email: 'tester@example.com' },
        })
      );
    });

    it('records an event given no message as one carrying none', async () => {
      await eventService.recordEvent(EventType.USER_SIGNED_IN, EventSeverity.INFO, {
        subjectType: EventPartyType.USER,
        detail: { email: 'tester@example.com' },
      });

      expect(eventRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ message: null }));
    });

    it('records an event the system raised as one carrying no actor', async () => {
      await eventService.recordEvent(EventType.USER_SIGN_IN_FAILED, EventSeverity.WARNING, {
        subjectType: EventPartyType.USER,
        detail: { email: 'tester@example.com' },
      });

      expect(eventRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: null, actorId: null, subjectId: null })
      );
    });

    it('hands the recorded event to an open stream', async () => {
      const streamed = firstValueFrom(eventService.eventRecorded());

      await eventService.recordEvent(EventType.USER_SIGNED_IN, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: '7',
        subjectType: EventPartyType.USER,
        subjectId: '7',
        detail: { email: 'tester@example.com' },
      });

      const event: Event = await streamed;

      expect(event.type).toBe(EventType.USER_SIGNED_IN);
      expect(event.actorId).toBe('7');
      expect(event.subjectId).toBe('7');
      expect(event.id).toBe(1);
    });
  });

  describe('findAndCount', () => {
    it('reads the newest events first', async () => {
      await eventService.findAndCount({}, 0, PAGE_SIZE);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith('event.id', 'DESC');
    });

    it('narrows on every criterion it is given', async () => {
      await eventService.findAndCount(
        {
          type: [EventType.USER_SIGNED_IN],
          severity: [EventSeverity.INFO],
          actorType: EventPartyType.USER,
          actorId: '7',
          subjectType: EventPartyType.USER,
          subjectId: '7',
          fromDate: new Date('2026-08-01T00:00:00.000Z'),
          toDate: new Date('2026-08-31T23:59:59.000Z'),
        },
        0,
        PAGE_SIZE
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledTimes(8);
    });

    it('narrows to what one actor did', async () => {
      await eventService.findAndCount({ actorType: EventPartyType.USER, actorId: '7' }, 0, PAGE_SIZE);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith('event.actorId = :actorId', { actorId: '7' });
    });

    it('leaves the query unnarrowed when no criteria are given', async () => {
      await eventService.findAndCount({}, 0, PAGE_SIZE);

      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('takes and skips what it was asked for', async () => {
      await eventService.findAndCount({}, PAGE_SIZE * 2, PAGE_SIZE);

      expect(queryBuilder.take).toHaveBeenCalledWith(PAGE_SIZE);
      expect(queryBuilder.skip).toHaveBeenCalledWith(PAGE_SIZE * 2);
    });

    it('answers with the rows and how many match in total', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[buildEvent(2), buildEvent(1)], 7]);

      const [events, total] = await eventService.findAndCount({}, 0, PAGE_SIZE);

      expect(events).toHaveLength(2);
      expect(total).toBe(7);
    });
  });
});
