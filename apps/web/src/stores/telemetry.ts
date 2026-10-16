import { useIntervalFn } from '@vueuse/core';
import { defineStore } from 'pinia';
import { Ref, computed, ref, shallowRef } from 'vue';

import { Config } from '@/Config';

export type TelemetryState = 'idle' | 'live' | 'stale';

export interface ITelemetryStream {
  connected: Ref<boolean>;
  lastActivityDate: Ref<Date | null>;
}

export const useTelemetryStore = defineStore('telemetry', () => {
  const streams = shallowRef<ITelemetryStream[]>([]);
  const now = ref(Date.now());

  const { pause, resume } = useIntervalFn(
    () => {
      now.value = Date.now();
    },
    1000,
    { immediate: false }
  );

  const isFresh = (stream: ITelemetryStream) =>
    stream.connected.value &&
    stream.lastActivityDate.value !== null &&
    now.value - stream.lastActivityDate.value.getTime() < Config.SSE_STALE_MS;

  /** Live only where every stream is current. */
  const state = computed<TelemetryState>(() => {
    if (streams.value.length === 0) {
      return 'idle';
    }

    return streams.value.every(isFresh) ? 'live' : 'stale';
  });

  const oldestActivityMs = computed<number | null>(() =>
    streams.value.reduce<number | null>((oldestMs, stream) => {
      const activityDate = stream.lastActivityDate.value;

      if (activityDate === null) {
        return oldestMs;
      }

      return oldestMs === null ? activityDate.getTime() : Math.min(oldestMs, activityDate.getTime());
    }, null)
  );

  /** Null until a stream has reported for the first time. */
  const ageSeconds = computed<number | null>(() => {
    if (oldestActivityMs.value === null) {
      return null;
    }

    return Math.max(0, Math.floor((now.value - oldestActivityMs.value) / 1000));
  });

  /** Idle until the stream has reported for the first time. */
  const stateOf = (stream: ITelemetryStream | null): TelemetryState => {
    if (stream === null || stream.lastActivityDate.value === null) {
      return 'idle';
    }

    return isFresh(stream) ? 'live' : 'stale';
  };

  /** Callers must run the returned call, or the stream is tracked for the life of the session. */
  function register(stream: ITelemetryStream): () => void {
    const tracked = { ...stream };

    streams.value = [...streams.value, tracked];
    now.value = Date.now();

    resume();

    return () => {
      streams.value = streams.value.filter(entry => entry !== tracked);

      if (streams.value.length === 0) {
        pause();
      }
    };
  }

  return {
    now,
    state,
    ageSeconds,
    stateOf,
    register,
  };
});
