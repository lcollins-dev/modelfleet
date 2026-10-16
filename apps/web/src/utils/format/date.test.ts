import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate, formatDateTime, formatDuration, formatFreshness, formatRelativeDate, formatTime } from './date';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('formatDate', () => {
  it('renders the date as day/month/short year', () => {
    expect(formatDate(new Date(2026, 4, 15))).toBe('15/05/26');
  });

  it('pads a single-digit day and month', () => {
    expect(formatDate(new Date(2026, 0, 2))).toBe('02/01/26');
  });

  it('ignores the time of day', () => {
    expect(formatDate(new Date(2026, 4, 15, 23, 59))).toBe('15/05/26');
  });

  it('rolls the year over at the turn of the century', () => {
    expect(formatDate(new Date(2000, 0, 1))).toBe('01/01/00');
  });
});

describe('formatTime', () => {
  it('renders a 24 hour time to the second', () => {
    expect(formatTime(new Date(2026, 4, 15, 14, 2, 11))).toBe('14:02:11');
  });

  it('pads a single-digit hour', () => {
    expect(formatTime(new Date(2026, 4, 15, 9, 5, 7))).toBe('09:05:07');
  });
});

describe('formatDateTime', () => {
  it('renders the date and a 12 hour time', () => {
    expect(formatDateTime(new Date(2026, 4, 15, 14, 30))).toBe('15/05/26 02:30pm');
  });

  it('marks a morning time as am', () => {
    expect(formatDateTime(new Date(2026, 4, 15, 9, 5))).toBe('15/05/26 09:05am');
  });

  it('renders midnight as 12am', () => {
    expect(formatDateTime(new Date(2026, 4, 15, 0, 0))).toBe('15/05/26 12:00am');
  });

  it('renders midday as 12pm', () => {
    expect(formatDateTime(new Date(2026, 4, 15, 12, 0))).toBe('15/05/26 12:00pm');
  });
});

describe('formatRelativeDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a recent date in minutes', () => {
    expect(formatRelativeDate(new Date(Date.now() - 25 * MINUTE_MS))).toBe('25 minutes ago');
  });

  it('renders an older date in hours', () => {
    expect(formatRelativeDate(new Date(Date.now() - 2 * HOUR_MS))).toBe('2 hours ago');
  });

  it('renders a much older date in days', () => {
    expect(formatRelativeDate(new Date(Date.now() - 3 * DAY_MS))).toBe('3 days ago');
  });

  it('renders a future date as time remaining', () => {
    expect(formatRelativeDate(new Date(Date.now() + 2 * HOUR_MS))).toBe('in 2 hours');
  });
});

describe('formatDuration', () => {
  it('formats sub-minute durations as seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats durations under an hour as minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats durations of an hour or more as hours, minutes, and seconds', () => {
    expect(formatDuration(3725)).toBe('1h 2m 5s');
  });

  it('omits zero parts at the tail', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3720)).toBe('1h 2m');
    expect(formatDuration(60)).toBe('1m');
  });

  it('renders zero as 0s', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('handles durations longer than a day', () => {
    expect(formatDuration(108_000)).toBe('30h');
  });
});

describe('formatFreshness', () => {
  it('gives the age of a live stream', () => {
    expect(formatFreshness('live', 5)).toBe('live · 5s');
  });

  it('reads a stale stream as old rather than as current', () => {
    expect(formatFreshness('stale', 41)).toBe('stale · 41s old');
  });

  it('names the state alone where there is no age to give', () => {
    expect(formatFreshness('idle', null)).toBe('idle');
    expect(formatFreshness('live', null)).toBe('live');
  });
});
