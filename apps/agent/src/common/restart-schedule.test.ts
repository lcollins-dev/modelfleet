import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

import { RestartSchedule } from '@/common/restart-schedule';

const OPTIONS = { initialDelayMs: 1000, maxDelayMs: 8000, jitterRatio: 0 };

describe('RestartSchedule', () => {
  let restart: Mock<() => void>;

  const build = () => new RestartSchedule(OPTIONS, restart);

  beforeEach(() => {
    vi.useFakeTimers();

    restart = vi.fn<() => void>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the restart once its delay has passed', () => {
    const schedule = build();

    expect(schedule.schedule()).toBe(1000);

    vi.advanceTimersByTime(999);
    expect(restart).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('waits longer before each further attempt', () => {
    const schedule = build();

    expect(schedule.schedule()).toBe(1000);
    expect(schedule.schedule()).toBe(2000);
    expect(schedule.schedule()).toBe(4000);
  });

  it('holds the delay at its ceiling', () => {
    const schedule = build();

    schedule.schedule();
    schedule.schedule();
    schedule.schedule();

    expect(schedule.schedule()).toBe(8000);
    expect(schedule.schedule()).toBe(8000);
  });

  it('counts the attempts it has made', () => {
    const schedule = build();

    schedule.schedule();
    schedule.schedule();

    expect(schedule.attempts).toBe(2);
  });

  it('goes back to the first delay once reset', () => {
    const schedule = build();

    schedule.schedule();
    schedule.schedule();
    schedule.reset();

    expect(schedule.schedule()).toBe(1000);
  });

  it('refuses to schedule once stopped', () => {
    const schedule = build();

    schedule.stop();

    expect(schedule.schedule()).toBeNull();

    vi.advanceTimersByTime(60_000);
    expect(restart).not.toHaveBeenCalled();
  });

  it('cancels a restart that was already pending when it stopped', () => {
    const schedule = build();

    schedule.schedule();
    schedule.stop();

    vi.advanceTimersByTime(60_000);

    expect(restart).not.toHaveBeenCalled();
  });

  it('stays stopped through a later reset', () => {
    const schedule = build();

    schedule.stop();
    schedule.reset();

    expect(schedule.schedule()).toBeNull();
  });

  it('shortens a delay by the jitter it was given', () => {
    const schedule = new RestartSchedule({ ...OPTIONS, jitterRatio: 0.5 }, restart, () => 1);

    expect(schedule.schedule()).toBe(500);
  });
});
