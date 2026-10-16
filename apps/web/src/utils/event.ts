import type { EventDto, EventFilterRequestDto } from '@libs/dto';
import { EventPartyType } from '@libs/dto';

const ACRONYMS: Record<string, string> = {
  api: 'API',
  gpu: 'GPU',
  vram: 'VRAM',
};

const PARTY_PATHS: Partial<Record<EventPartyType, string>> = {
  [EventPartyType.USER]: '/users',
  [EventPartyType.NODE]: '/nodes',
  [EventPartyType.MODEL]: '/models',
  [EventPartyType.PRESET]: '/presets',
  [EventPartyType.DEPLOYMENT]: '/deployments',
  [EventPartyType.DOWNLOAD]: '/downloads',
};

export const eventPartyPath = (type: EventPartyType | undefined, id: string | undefined): string | undefined => {
  const base = type === undefined ? undefined : PARTY_PATHS[type];

  return base === undefined || id === undefined ? undefined : `${base}/${id}`;
};

/** Reads a type this build has never seen, since event types arrive with the features that record them. */
export const formatEventType = (type: string): string => {
  const words = type
    .split(/[.\-_]/)
    .filter(word => word.length > 0)
    .map(word => ACRONYMS[word] ?? word);

  if (words.length === 0) {
    return type;
  }

  return `${words[0].charAt(0).toUpperCase()}${words[0].slice(1)} ${words.slice(1).join(' ')}`.trim();
};

/** Mirrors the server's list filter, so a live event is held to the same terms as a fetched one. */
export const matchesEventFilter = (event: EventDto, filter: EventFilterRequestDto): boolean => {
  if (filter.type !== undefined && filter.type.length > 0 && !filter.type.includes(event.type)) {
    return false;
  }

  if (filter.severity !== undefined && filter.severity.length > 0 && !filter.severity.includes(event.severity)) {
    return false;
  }

  if (filter.actorType !== undefined && filter.actorType !== event.actorType) {
    return false;
  }

  if (filter.actorId !== undefined && filter.actorId !== event.actorId) {
    return false;
  }

  if (filter.subjectType !== undefined && filter.subjectType !== event.subjectType) {
    return false;
  }

  if (filter.subjectId !== undefined && filter.subjectId !== event.subjectId) {
    return false;
  }

  const createdMs = event.createdDate.getTime();

  if (filter.fromDate !== undefined && createdMs < new Date(filter.fromDate).getTime()) {
    return false;
  }

  if (filter.toDate !== undefined && createdMs > new Date(filter.toDate).getTime()) {
    return false;
  }

  return true;
};
