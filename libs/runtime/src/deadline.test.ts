import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Deadline } from './deadline';

describe('Deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls back once the delay passes', () => {
    const deadline = new Deadline();
    const onMissed = vi.fn();

    deadline.expect(1000, onMissed);
    vi.advanceTimersByTime(999);

    expect(onMissed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(onMissed).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending deadline with the next one expected', () => {
    const deadline = new Deadline();
    const first = vi.fn();
    const second = vi.fn();

    deadline.expect(1000, first);
    deadline.expect(2000, second);
    vi.advanceTimersByTime(2000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('calls nothing once stopped', () => {
    const deadline = new Deadline();
    const onMissed = vi.fn();

    deadline.expect(1000, onMissed);
    deadline.stop();
    vi.advanceTimersByTime(1000);

    expect(onMissed).not.toHaveBeenCalled();
  });

  it('accepts a stop with nothing pending', () => {
    expect(() => new Deadline().stop()).not.toThrow();
  });
});
