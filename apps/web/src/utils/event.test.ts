import { describe, expect, it } from 'vitest';

import type { EventDto } from '@libs/dto';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { eventPartyPath, formatEventType, matchesEventFilter } from './event';

const buildEvent = (overrides: Partial<EventDto> = {}): EventDto => ({
  id: 1,
  type: EventType.USER_SIGNED_IN,
  severity: EventSeverity.INFO,
  actorType: EventPartyType.USER,
  actorId: '42',
  subjectType: EventPartyType.USER,
  subjectId: '42',
  detail: { email: 'tester@example.com' },
  createdDate: new Date('2026-08-22T10:00:00.000Z'),
  ...overrides,
});

describe('formatEventType', () => {
  it('reads a namespaced type as a sentence', () => {
    expect(formatEventType('user.signed-in')).toBe('User signed in');
  });

  it('reads a type this build has never seen', () => {
    expect(formatEventType('node.gpu_snapshot-received')).toBe('Node GPU snapshot received');
  });

  it('writes an acronym in capitals', () => {
    expect(formatEventType(EventType.API_KEY_CREATED)).toBe('API key created');
    expect(formatEventType(EventType.API_KEY_REVOKED)).toBe('API key revoked');
  });

  it('reads every type this build records as a sentence with no lower-case acronym', () => {
    for (const type of Object.values(EventType)) {
      expect(formatEventType(type)).toMatch(/^[A-Z]/);
      expect(formatEventType(type)).not.toMatch(/[.\-_]|\b(api|gpu|vram)\b/);
    }
  });

  it('keeps a single word', () => {
    expect(formatEventType('started')).toBe('Started');
  });

  it('hands back a type it cannot split', () => {
    expect(formatEventType('...')).toBe('...');
  });
});

describe('matchesEventFilter', () => {
  it('matches an event against an empty filter', () => {
    expect(matchesEventFilter(buildEvent(), {})).toBe(true);
  });

  it('holds an event to every term at once', () => {
    const filter = { type: [EventType.USER_SIGNED_IN], severity: [EventSeverity.ERROR] };

    expect(matchesEventFilter(buildEvent(), filter)).toBe(false);
  });

  it('matches on any of the listed types', () => {
    const filter = { type: [EventType.USER_SIGN_IN_FAILED, EventType.USER_SIGNED_IN] };

    expect(matchesEventFilter(buildEvent(), filter)).toBe(true);
  });

  it('rejects a type outside the list', () => {
    expect(matchesEventFilter(buildEvent(), { type: [EventType.USER_SIGN_IN_FAILED] })).toBe(false);
  });

  it('matches on severity', () => {
    expect(matchesEventFilter(buildEvent(), { severity: [EventSeverity.INFO] })).toBe(true);
    expect(matchesEventFilter(buildEvent(), { severity: [EventSeverity.WARNING] })).toBe(false);
  });

  it('matches the actor and the subject separately', () => {
    expect(matchesEventFilter(buildEvent({ actorId: '7' }), { actorId: '42' })).toBe(false);
    expect(matchesEventFilter(buildEvent({ subjectId: '7' }), { subjectId: '42' })).toBe(false);
    expect(matchesEventFilter(buildEvent({ actorId: '7' }), { subjectId: '42' })).toBe(true);
  });

  it('rejects an event with no actor where the filter names one', () => {
    const event = buildEvent({ actorType: undefined, actorId: undefined });

    expect(matchesEventFilter(event, { actorType: EventPartyType.USER })).toBe(false);
  });

  it('takes both ends of the date range as inclusive', () => {
    const filter = { fromDate: '2026-08-22T10:00:00.000Z', toDate: '2026-08-22T10:00:00.000Z' };

    expect(matchesEventFilter(buildEvent(), filter)).toBe(true);
  });

  it('rejects an event outside the date range', () => {
    expect(matchesEventFilter(buildEvent(), { fromDate: '2026-08-22T10:00:01.000Z' })).toBe(false);
    expect(matchesEventFilter(buildEvent(), { toDate: '2026-08-22T09:59:59.000Z' })).toBe(false);
  });

  it('reads a date the api handed over as a string', () => {
    const event = buildEvent({ createdDate: new Date('2026-08-22T10:00:00.000Z') });

    expect(matchesEventFilter(event, { fromDate: '2026-08-22T09:00:00.000Z' })).toBe(true);
  });
});

describe('eventPartyPath', () => {
  it('routes a party to its own page by type', () => {
    expect(eventPartyPath(EventPartyType.USER, '3')).toBe('/users/3');
    expect(eventPartyPath(EventPartyType.NODE, '7')).toBe('/nodes/7');
    expect(eventPartyPath(EventPartyType.MODEL, '2')).toBe('/models/2');
    expect(eventPartyPath(EventPartyType.PRESET, '4')).toBe('/presets/4');
    expect(eventPartyPath(EventPartyType.DEPLOYMENT, '5')).toBe('/deployments/5');
    expect(eventPartyPath(EventPartyType.DOWNLOAD, '6')).toBe('/downloads/6');
  });

  it('gives no route to an API key, which has no page', () => {
    expect(eventPartyPath(EventPartyType.API_KEY, '8')).toBeUndefined();
  });

  it('gives no route to a party without a type or an id', () => {
    expect(eventPartyPath(undefined, '3')).toBeUndefined();
    expect(eventPartyPath(EventPartyType.NODE, undefined)).toBeUndefined();
  });
});
