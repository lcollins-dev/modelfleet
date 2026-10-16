import { EventSourceClient, createEventSource } from 'eventsource-client';
import { Ref, ref } from 'vue';
import type { z } from 'zod';

import { isErrorResponse } from '@libs/dto';

import { RequestStatus } from '@/types/api';

import { Config } from '@/Config';

import { useLogService } from '@/services/LogService';
import { useTelemetryStore } from '@/stores/telemetry';

const logService = useLogService();
const logger = logService.createLogger('services/api/SseService');

export interface ISseSubscription {
  connected: Ref<boolean>;
  lastActivityDate: Ref<Date | null>;
  close: () => void;
}

export interface ISseRefusal {
  status: number;
  message: string | null;
}

export interface ISseOptions {
  /** Sent as an `Authorization: Bearer` header. */
  token?: string | null;
  /** Time without any frame after which the connection is dropped and remade. */
  staleMs?: number;
  /** Runs on every connection after the first, never on the initial one. */
  onReconnect?: () => void;
  /** Given, a response other than 200 closes the subscription and reaches it, rather than being retried. */
  onRefusal?: (refusal: ISseRefusal) => void;
}

export const useSseService = () => {
  const telemetryStore = useTelemetryStore();

  /** Only frames with no event name reach `onPayload`. A frame the schema refuses is logged and dropped. */
  function subscribe<Schema extends z.ZodType>(
    endpoint: string,
    schema: Schema,
    onPayload: (payload: z.output<Schema>) => void,
    options?: ISseOptions
  ): ISseSubscription {
    const staleMs = options?.staleMs ?? Config.SSE_STALE_MS;
    const connected = ref(false);
    const lastActivityDate = ref<Date | null>(null);
    const headers: { [key: string]: string } = {};

    const deregisterTelemetry = telemetryStore.register({ connected, lastActivityDate });

    if (options?.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    let watchdog: ReturnType<typeof setTimeout> | null = null;
    let connections = 0;

    const clearWatchdog = () => {
      if (watchdog !== null) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const touch = () => {
      lastActivityDate.value = new Date();

      clearWatchdog();

      watchdog = setTimeout(() => restart(), staleMs);
    };

    const close = () => {
      connected.value = false;

      clearWatchdog();
      source.close();
      deregisterTelemetry();
    };

    // The client takes any status as a connection and retries it, so a refusal is caught before it sees one.
    const fetchRefusing = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const response = await fetch(url, init);
      const onRefusal = options?.onRefusal;

      if (onRefusal === undefined || response.status === RequestStatus.SUCCESS) {
        return response;
      }

      const body: unknown = await response.json().catch(() => undefined);

      if (init?.signal?.aborted === true) {
        throw new Error('The refused stream was already closed');
      }

      close();
      onRefusal({ status: response.status, message: isErrorResponse(body) ? body.message : null });

      throw new Error(`The stream was refused with ${response.status}`);
    };

    const createSource = (lastEventId?: string): EventSourceClient =>
      createEventSource({
        url: `${Config.API_BASE_URL}${endpoint}`,
        headers,
        initialLastEventId: lastEventId,
        fetch: fetchRefusing,
        onConnect: () => {
          connections += 1;
          connected.value = true;

          touch();

          if (connections > 1) {
            options?.onReconnect?.();
          }
        },
        onDisconnect: () => {
          connected.value = false;

          clearWatchdog();
        },
        onMessage: message => {
          touch();

          if (message.event !== undefined) {
            return;
          }

          const parsed = schema.safeParse(readJson(message.data));

          if (!parsed.success) {
            logger.error({ issues: parsed.error.issues, endpoint }, 'subscribe(): Dropping an unexpected frame');

            return;
          }

          onPayload(parsed.data);
        },
      });

    /** A closed client answers `connect()` with nothing until its aborted request settles. */
    const restart = () => {
      const lastEventId = source.lastEventId;

      source.close();

      source = createSource(lastEventId);
    };

    let source = createSource();

    return {
      connected,
      lastActivityDate,
      close,
    };
  }

  function readJson(data: string): unknown {
    try {
      return JSON.parse(data);
    } catch {
      return undefined;
    }
  }

  return {
    subscribe,
  };
};
