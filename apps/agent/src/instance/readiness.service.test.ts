import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReadinessProbe, ProbeMethod } from '@libs/backends';

import { ConfigService } from '@/config/config.service';
import { ReadinessService } from '@/instance/readiness.service';
import { TEST_INSTANCE_KEY } from '@/test/instance.factory';

const CONTAINER_ID = 'c0ffee';
const ENDPOINT = 'http://127.0.0.1:32768';

const PROBE: ReadinessProbe = {
  method: ProbeMethod.GET,
  path: '/health',
  passStatuses: [200],
  body: { path: 'status', equals: 'ok' },
};

const configService = {
  instanceProbeTimeoutMs: 2000,
  instanceProbeBackoff: { initialDelayMs: 10, maxDelayMs: 20, jitterRatio: 0 },
} as unknown as ConfigService;

const JSON_HEADERS = new Headers([['content-type', 'application/json']]);

const answering = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }));

describe('ReadinessService', () => {
  let readinessService: ReadinessService;
  let fetched: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    readinessService = new ReadinessService(configService);
    fetched = vi.fn();

    vi.stubGlobal('fetch', fetched);
  });

  afterEach(() => {
    readinessService.onModuleDestroy();
    vi.unstubAllGlobals();
  });

  it('holds the instance unproven until the probe passes, and polls again meanwhile', async () => {
    fetched
      .mockReturnValueOnce(answering(503, { status: 'loading model' }))
      .mockReturnValue(answering(200, { status: 'ok' }));

    readinessService.watch(TEST_INSTANCE_KEY, CONTAINER_ID, ENDPOINT, PROBE);

    expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(false);

    await vi.waitFor(() => {
      expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(true);
    });

    expect(fetched.mock.calls[0][0]).toBe(`${ENDPOINT}/health`);
  });

  it('announces the pass, so the node reports it without waiting for the next reconcile', async () => {
    fetched.mockReturnValue(answering(200, { status: 'ok' }));

    const passed: string[] = [];
    readinessService.changes().subscribe(instanceKey => passed.push(instanceKey));

    readinessService.watch(TEST_INSTANCE_KEY, CONTAINER_ID, ENDPOINT, PROBE);

    await vi.waitFor(() => {
      expect(passed).toEqual([TEST_INSTANCE_KEY]);
    });
  });

  it('keeps polling a backend that refuses the connection', async () => {
    fetched.mockRejectedValue(new Error('connect ECONNREFUSED'));

    readinessService.watch(TEST_INSTANCE_KEY, CONTAINER_ID, ENDPOINT, PROBE);

    await vi.waitFor(() => {
      expect(fetched.mock.calls.length).toBeGreaterThan(1);
    });

    expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(false);
  });

  it('proves a replacement container again rather than trusting what the one before it passed', async () => {
    fetched.mockReturnValue(answering(200, { status: 'ok' }));

    readinessService.watch(TEST_INSTANCE_KEY, CONTAINER_ID, ENDPOINT, PROBE);

    await vi.waitFor(() => {
      expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(true);
    });

    expect(readinessService.isReady(TEST_INSTANCE_KEY, 'another-container')).toBe(false);
  });

  it('drops what it proved when the instance is forgotten', async () => {
    fetched.mockReturnValue(answering(200, { status: 'ok' }));

    readinessService.watch(TEST_INSTANCE_KEY, CONTAINER_ID, ENDPOINT, PROBE);

    await vi.waitFor(() => {
      expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(true);
    });

    readinessService.forget(TEST_INSTANCE_KEY);

    expect(readinessService.isReady(TEST_INSTANCE_KEY, CONTAINER_ID)).toBe(false);
  });
});
