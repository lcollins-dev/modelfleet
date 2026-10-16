import { MessageEvent } from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withHeartbeat } from '@/common/sse';

describe('withHeartbeat', () => {
  let payloads: Subject<string | object>;
  let seen: MessageEvent[];
  let subscription: Subscription;

  beforeEach(() => {
    vi.useFakeTimers();

    payloads = new Subject<string | object>();
    seen = [];

    subscription = withHeartbeat(payloads).subscribe(event => seen.push(event));
  });

  afterEach(() => {
    subscription.unsubscribe();
    vi.useRealTimers();
  });

  it('sends a payload as a frame naming no event, which is what carries data to a client', () => {
    payloads.next({ value: 42 });

    expect(seen).toEqual([{ data: { value: 42 } }]);
  });

  it('beats often enough to hold a connection an intermediary would otherwise close', () => {
    vi.advanceTimersByTime(5000);

    expect(seen).toEqual([{ type: 'heartbeat', data: 'beat' }]);
  });

  it('carries data on every beat, since a client discards a frame whose data buffer stays empty', () => {
    vi.advanceTimersByTime(100000);

    expect(seen.every(event => typeof event.data === 'string' && event.data.length > 0)).toBe(true);
  });

  it('keeps beating through a stream that never sends anything', () => {
    vi.advanceTimersByTime(100000);

    expect(seen).toHaveLength(20);
  });

  it('names the heartbeat so a client counts it as proof of life rather than as data', () => {
    vi.advanceTimersByTime(5000);
    payloads.next({ value: 1 });

    expect(seen.filter(event => event.type === undefined)).toEqual([{ data: { value: 1 } }]);
  });

  it('keeps beating after the payloads complete, so the response stays open until the client leaves', () => {
    payloads.complete();

    vi.advanceTimersByTime(5000);

    expect(seen).toEqual([{ type: 'heartbeat', data: 'beat' }]);
  });

  it('completes with the payloads where asked to, so a stream that has said everything ends its response', () => {
    const ending = new Subject<string | object>();
    const ended: MessageEvent[] = [];
    let completed = false;

    withHeartbeat(ending, { endWithPayloads: true }).subscribe({
      next: event => ended.push(event),
      complete: () => (completed = true),
    });

    ending.next({ value: 1 });
    ending.complete();
    vi.advanceTimersByTime(100000);

    expect(completed).toBe(true);
    expect(ended).toEqual([{ data: { value: 1 } }]);
  });

  it('stops beating once the connection ends, so a closed stream leaves no timer behind', () => {
    subscription.unsubscribe();

    vi.advanceTimersByTime(100000);

    expect(seen).toEqual([]);
  });
});
