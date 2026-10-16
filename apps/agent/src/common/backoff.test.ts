import { describe, expect, it } from 'vitest';

import { Backoff } from '@/common/backoff';

const OPTIONS = { initialDelayMs: 1000, maxDelayMs: 30_000, jitterRatio: 0 };

describe('Backoff', () => {
  it('doubles the wait after each attempt', () => {
    const backoff = new Backoff(OPTIONS);

    expect([backoff.next(), backoff.next(), backoff.next(), backoff.next()]).toEqual([1000, 2000, 4000, 8000]);
  });

  it('holds at the ceiling however many attempts have failed', () => {
    const backoff = new Backoff(OPTIONS);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      backoff.next();
    }

    expect(backoff.next()).toBe(30_000);
  });

  it('starts over once a connection succeeds', () => {
    const backoff = new Backoff(OPTIONS);

    backoff.next();
    backoff.next();
    backoff.reset();

    expect(backoff.next()).toBe(1000);
    expect(backoff.attempts).toBe(1);
  });

  it('draws jitter off the delay, so two agents do not return together', () => {
    const backoff = new Backoff({ ...OPTIONS, jitterRatio: 0.2 }, () => 1);

    expect(backoff.next()).toBe(800);
  });

  it('never waits longer than the delay it computed', () => {
    const backoff = new Backoff({ ...OPTIONS, jitterRatio: 0.5 }, () => 0);

    expect(backoff.next()).toBe(1000);
  });
});
