import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Config } from '@/Config';

import { useTelemetryStore } from '@/stores/telemetry';

import { useSseService } from './SseService';

const ENDPOINT = 'admin/event/stream';

const PAYLOAD = z.object({ id: z.number() });

interface IServedStream {
  url: string;
  headers: { [key: string]: string };
  aborted: boolean;
  send: (frame: string) => void;
  end: () => void;
}

const encoder = new TextEncoder();
const served: IServedStream[] = [];

const serve = (url: string, headers: { [key: string]: string }, signal: AbortSignal): ReadableStream<Uint8Array> => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const body = new ReadableStream<Uint8Array>({
    start: given => {
      controller = given;
    },
  });

  const stream: IServedStream = {
    url,
    headers,
    aborted: false,
    send: frame => controller.enqueue(encoder.encode(frame)),
    end: () => controller.close(),
  };

  signal.addEventListener('abort', () => {
    stream.aborted = true;

    controller.error(new DOMException('aborted', 'AbortError'));
  });

  served.push(stream);

  return body;
};

const payloadFrame = (payload: object): string => `data: ${JSON.stringify(payload)}\n\n`;
const heartbeatFrame = (): string => 'event: heartbeat\ndata: beat\n\n';

/** The client reads its stream across several promise turns, none of which a timer drives. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 20; turn++) {
    await Promise.resolve();
  }
};

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

describe('SseService', () => {
  beforeEach(() => {
    vi.useFakeTimers();

    setActivePinia(createPinia());

    served.length = 0;

    vi.stubGlobal('fetch', (url: string, init: { headers: { [key: string]: string }; signal: AbortSignal }) =>
      Promise.resolve({
        status: 200,
        redirected: false,
        url,
        body: serve(url, init.headers, init.signal),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('subscribe', () => {
    it('resolves the endpoint against the API base, as a request would', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      await settle();

      expect(served[0].url).toBe(`${Config.API_BASE_URL}${ENDPOINT}`);
    });

    it('carries the token a browser event source could not', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { token: 'signed-jwt' });

      await settle();

      expect(served[0].headers.Authorization).toBe('Bearer signed-jwt');
    });

    it('sends no authorization header where the caller has no token', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { token: null });

      await settle();

      expect(served[0].headers.Authorization).toBeUndefined();
    });

    it('hands on the payload of a frame that names no event', async () => {
      const onPayload = vi.fn();
      useSseService().subscribe(ENDPOINT, PAYLOAD, onPayload);

      await settle();
      served[0].send(payloadFrame({ id: 42 }));
      await settle();

      expect(onPayload).toHaveBeenCalledWith({ id: 42 });
    });

    it('decodes a payload through its schema, dropping fields it does not name', async () => {
      const onPayload = vi.fn();
      useSseService().subscribe(ENDPOINT, z.object({ createdDate: z.iso.datetime().pipe(z.coerce.date()) }), onPayload);

      await settle();
      served[0].send(payloadFrame({ createdDate: '2026-05-15T12:00:00.000Z', extra: true }));
      await settle();

      expect(onPayload).toHaveBeenCalledWith({ createdDate: new Date('2026-05-15T12:00:00.000Z') });
    });

    it('drops a frame its schema refuses, and one that is not JSON', async () => {
      const onPayload = vi.fn();
      useSseService().subscribe(ENDPOINT, PAYLOAD, onPayload);

      await settle();
      served[0].send(payloadFrame({ id: 'forty-two' }));
      served[0].send('data: {not json\n\n');
      served[0].send(payloadFrame({ id: 42 }));
      await settle();

      expect(onPayload).toHaveBeenCalledTimes(1);
      expect(onPayload).toHaveBeenCalledWith({ id: 42 });
    });

    it('treats a named frame as proof of life rather than as a payload', async () => {
      const onPayload = vi.fn();
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, onPayload);

      await settle();
      await advance(10000);
      served[0].send(heartbeatFrame());
      await settle();

      expect(onPayload).not.toHaveBeenCalled();
      expect(subscription.lastActivityDate.value).toEqual(new Date());
    });

    it('recovers from a silent stream, which no transport error would reveal', async () => {
      const onPayload = vi.fn();
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, onPayload);

      await settle();
      await advance(Config.SSE_STALE_MS);

      expect(served[0].aborted).toBe(true);
      expect(served).toHaveLength(2);

      served[1].send(payloadFrame({ id: 7 }));
      await settle();

      expect(onPayload).toHaveBeenCalledWith({ id: 7 });
      expect(subscription.connected.value).toBe(true);
    });

    it('keeps recovering, so a stream that goes silent a second time still comes back', async () => {
      const onPayload = vi.fn();
      useSseService().subscribe(ENDPOINT, PAYLOAD, onPayload);

      await settle();
      await advance(Config.SSE_STALE_MS);
      await advance(Config.SSE_STALE_MS);

      expect(served).toHaveLength(3);

      served[2].send(payloadFrame({ id: 9 }));
      await settle();

      expect(onPayload).toHaveBeenCalledWith({ id: 9 });
    });

    it('leaves a connection alone for as long as it keeps talking', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      await settle();

      for (let beat = 0; beat < 10; beat++) {
        await advance(Config.SSE_STALE_MS - 1000);
        served[0].send(heartbeatFrame());
        await settle();
      }

      expect(served).toHaveLength(1);
    });

    it('honours a caller that wants a different patience', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { staleMs: 5000 });

      await settle();
      await advance(5000);

      expect(served).toHaveLength(2);
    });

    it('waits on the client while it is disconnected rather than racing its own reconnect', async () => {
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      await settle();
      served[0].end();
      await advance(Config.SSE_STALE_MS);

      expect(served).toHaveLength(2);
    });

    it('reports the gap only once the stream is remade', async () => {
      const onReconnect = vi.fn();
      useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { onReconnect });

      await settle();

      expect(onReconnect).not.toHaveBeenCalled();

      await advance(Config.SSE_STALE_MS);

      expect(onReconnect).toHaveBeenCalledTimes(1);
    });

    it('tracks whether the stream is up', async () => {
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      expect(subscription.connected.value).toBe(false);
      expect(subscription.lastActivityDate.value).toBeNull();

      await settle();

      expect(subscription.connected.value).toBe(true);
      expect(subscription.lastActivityDate.value).toEqual(new Date());

      served[0].end();
      await settle();

      expect(subscription.connected.value).toBe(false);
    });

    it('closes the underlying client when asked to', async () => {
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      await settle();
      subscription.close();

      expect(served[0].aborted).toBe(true);
      expect(subscription.connected.value).toBe(false);
    });

    it('stops watching once closed, so a torn-down page leaves nothing running', async () => {
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      await settle();
      subscription.close();
      await advance(Config.SSE_STALE_MS);

      expect(served).toHaveLength(1);
    });

    describe('refusal', () => {
      const refuseWith = (status: number, body: unknown) => {
        const requests = vi.fn();

        vi.stubGlobal('fetch', () => {
          requests();

          return Promise.resolve({ status, json: () => Promise.resolve(body) });
        });

        return requests;
      };

      it('hands a refusal on with the api message and stops asking', async () => {
        const requests = refuseWith(409, { statusCode: 409, message: 'The node is not connected' });
        const onRefusal = vi.fn();
        const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { onRefusal });

        await settle();
        await advance(Config.SSE_STALE_MS);

        expect(onRefusal).toHaveBeenCalledExactlyOnceWith({ status: 409, message: 'The node is not connected' });
        expect(requests).toHaveBeenCalledTimes(1);
        expect(subscription.connected.value).toBe(false);
        expect(useTelemetryStore().state).toBe('idle');
      });

      it('hands on no message where the body carried none', async () => {
        refuseWith(502, 'Bad Gateway');
        const onRefusal = vi.fn();
        useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { onRefusal });

        await settle();

        expect(onRefusal).toHaveBeenCalledExactlyOnceWith({ status: 502, message: null });
      });

      it('hands on no refusal for a stream closed while the refusal was being read', async () => {
        let answer: (body: unknown) => void = () => undefined;

        vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) =>
          Promise.resolve({
            status: 404,
            json: () =>
              new Promise(resolve => {
                answer = body => {
                  expect(init.signal.aborted).toBe(true);
                  resolve(body);
                };
              }),
          })
        );
        const onRefusal = vi.fn();
        const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn(), { onRefusal });

        await settle();
        subscription.close();
        answer({ statusCode: 404, message: 'This instance does not exist' });
        await settle();

        expect(onRefusal).not.toHaveBeenCalled();
      });

      it('keeps retrying a refused stream for a caller that takes no refusal', async () => {
        const requests = refuseWith(503, undefined);
        useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

        await settle();
        await advance(Config.SSE_STALE_MS);

        expect(requests.mock.calls.length).toBeGreaterThan(1);
      });
    });

    it('reports the stream to the telemetry store for as long as it is open', async () => {
      const telemetryStore = useTelemetryStore();
      const subscription = useSseService().subscribe(ENDPOINT, PAYLOAD, vi.fn());

      expect(telemetryStore.state).toBe('stale');

      await settle();

      expect(telemetryStore.state).toBe('live');

      subscription.close();

      expect(telemetryStore.state).toBe('idle');
    });
  });
});
