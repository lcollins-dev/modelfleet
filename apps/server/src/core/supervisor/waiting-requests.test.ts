import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcquireRefusal, IAcquireOptions } from '@/core/supervisor/supervisor.types';
import { WaitingRequests } from '@/core/supervisor/waiting-requests';

const DEPLOYMENT_ID = 7;

const RESULT = { lease: null, refusal: AcquireRefusal.FAILED, problem: 'oops', retryInMs: null, waitedMs: null };

describe('WaitingRequests', () => {
  let waitingRequests: WaitingRequests;

  const options = (overrides: Partial<IAcquireOptions> = {}): IAcquireOptions => ({
    signal: new AbortController().signal,
    maxWaitMs: 60_000,
    onWait: vi.fn(),
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    waitingRequests = new WaitingRequests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers a request the first look settles, without telling the caller it waits', async () => {
    const onWait = vi.fn();

    const result = await waitingRequests.wait(DEPLOYMENT_ID, options({ onWait }), () => {
      waitingRequests.settleAll(DEPLOYMENT_ID, RESULT);

      return Promise.resolve();
    });

    expect(result).toMatchObject({ refusal: AcquireRefusal.FAILED, problem: 'oops' });
    expect(onWait).not.toHaveBeenCalled();
  });

  it('tells the caller it waits once the first look leaves it waiting', async () => {
    const onWait = vi.fn();

    void waitingRequests.wait(DEPLOYMENT_ID, options({ onWait }), () => Promise.resolve());
    await vi.advanceTimersByTimeAsync(0);

    expect(onWait).toHaveBeenCalledOnce();
    expect(waitingRequests.open(DEPLOYMENT_ID)).toHaveLength(1);
  });

  it('tells the caller it waits after a grace where the first look is slow, and times it out from the start', async () => {
    const onWait = vi.fn();
    const waiting = waitingRequests.wait(DEPLOYMENT_ID, options({ onWait }), () => new Promise(() => undefined));

    await vi.advanceTimersByTimeAsync(999);
    expect(onWait).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onWait).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(59_000);

    await expect(waiting).resolves.toMatchObject({ refusal: AcquireRefusal.TIMED_OUT });
  });

  it('settles a request once, however many answers arrive, and lets it go once settled', async () => {
    const waiting = waitingRequests.wait(DEPLOYMENT_ID, options(), () => Promise.resolve());

    await vi.advanceTimersByTimeAsync(0);

    const [waiter] = waitingRequests.open(DEPLOYMENT_ID);

    expect(waiter.settle(RESULT)).toBe(true);
    expect(waiter.settle({ ...RESULT, problem: 'later' })).toBe(false);
    await expect(waiting).resolves.toMatchObject({ problem: 'oops' });
    expect(waitingRequests.open(DEPLOYMENT_ID)).toEqual([]);
  });

  it('lets a caller that leaves go without a result, and starts nothing for one already gone', async () => {
    const controller = new AbortController();
    const firstLook = vi.fn(() => Promise.resolve());
    const waiting = waitingRequests.wait(DEPLOYMENT_ID, options({ signal: controller.signal }), firstLook);

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    await expect(waiting).resolves.toMatchObject({ lease: null, refusal: null });

    const gone = new AbortController();

    gone.abort();
    firstLook.mockClear();

    await waitingRequests.wait(DEPLOYMENT_ID, options({ signal: gone.signal }), firstLook);

    expect(firstLook).not.toHaveBeenCalled();
  });
});
