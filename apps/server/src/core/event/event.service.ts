import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { Repository } from 'typeorm';

import { EventDetailMap, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Event } from './entities/event.entity';

export interface IRecordEventOptions<T extends EventType> {
  actorType?: EventPartyType;
  actorId?: string;
  subjectType?: EventPartyType;
  subjectId?: string;
  /** One line saying what happened, in the `**bold**`, `*italic*` and `` `code` `` subset the reader renders. */
  message?: string;
  detail: EventDetailMap[T];
}

export interface IEventCriteria {
  type?: EventType[];
  severity?: EventSeverity[];
  actorType?: EventPartyType;
  actorId?: string;
  subjectType?: EventPartyType;
  subjectId?: string;
  fromDate?: Date;
  toDate?: Date;
}

@Injectable()
export class EventService {
  private readonly eventSubject = new Subject<Event>();

  constructor(
    @InjectRepository(Event)
    private readonly eventRepository: Repository<Event>
  ) {}

  /** Open streams see the event as it is written, so a caller inside a transaction publishes before it commits. */
  async recordEvent<T extends EventType>(
    type: T,
    severity: EventSeverity,
    options: IRecordEventOptions<T>
  ): Promise<void> {
    const event = new Event({
      type,
      severity,
      actorType: options.actorType ?? null,
      actorId: options.actorId ?? null,
      subjectType: options.subjectType ?? null,
      subjectId: options.subjectId ?? null,
      message: options.message ?? null,
      detail: options.detail,
    });

    await this.eventRepository.insert(event);

    this.eventSubject.next(event);
  }

  /** Newest first. */
  findAndCount(criteria: IEventCriteria, skip: number, take: number): Promise<[Event[], number]> {
    const queryBuilder = this.eventRepository.createQueryBuilder('event');

    if (criteria.type !== undefined) {
      queryBuilder.andWhere('event.type IN (:...type)', { type: criteria.type });
    }

    if (criteria.severity !== undefined) {
      queryBuilder.andWhere('event.severity IN (:...severity)', { severity: criteria.severity });
    }

    if (criteria.actorType !== undefined) {
      queryBuilder.andWhere('event.actorType = :actorType', { actorType: criteria.actorType });
    }

    if (criteria.actorId !== undefined) {
      queryBuilder.andWhere('event.actorId = :actorId', { actorId: criteria.actorId });
    }

    if (criteria.subjectType !== undefined) {
      queryBuilder.andWhere('event.subjectType = :subjectType', { subjectType: criteria.subjectType });
    }

    if (criteria.subjectId !== undefined) {
      queryBuilder.andWhere('event.subjectId = :subjectId', { subjectId: criteria.subjectId });
    }

    if (criteria.fromDate !== undefined) {
      queryBuilder.andWhere('event.createdDate >= :fromDate', { fromDate: criteria.fromDate });
    }

    if (criteria.toDate !== undefined) {
      queryBuilder.andWhere('event.createdDate <= :toDate', { toDate: criteria.toDate });
    }

    return queryBuilder.orderBy('event.id', 'DESC').take(take).skip(skip).getManyAndCount();
  }

  eventRecorded(): Observable<Event> {
    return this.eventSubject.asObservable();
  }
}
