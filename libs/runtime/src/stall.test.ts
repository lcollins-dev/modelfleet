import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Stall } from './stall';

describe('Stall', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts once the limit passes with no progress', () => {
    const stall = new Stall(1000);

    vi.advanceTimersByTime(999);

    expect(stall.stalled).toBe(false);

    vi.advanceTimersByTime(1);

    expect(stall.stalled).toBe(true);
    expect(stall.signal.aborted).toBe(true);
  });

  it('counts the limit again from each progress, however long it runs in all', () => {
    const stall = new Stall(1000);

    for (let step = 0; step < 10; step += 1) {
      vi.advanceTimersByTime(999);
      stall.progressed();
    }

    expect(stall.stalled).toBe(false);
  });

  it('never aborts once stopped', () => {
    const stall = new Stall(1000);

    stall.stop();
    vi.advanceTimersByTime(5000);

    expect(stall.stalled).toBe(false);
  });

  it('never aborts with a limit of 0', () => {
    const stall = new Stall(0);

    vi.advanceTimersByTime(60_000);
    stall.progressed();

    expect(stall.stalled).toBe(false);
  });
});
