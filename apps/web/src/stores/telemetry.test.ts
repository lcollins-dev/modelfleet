import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { Config } from '@/Config';

import { ITelemetryStream, useTelemetryStore } from './telemetry';

const stream = (connected: boolean, lastActivityDate: Date | null): ITelemetryStream => ({
  connected: ref(connected),
  lastActivityDate: ref(lastActivityDate),
});

describe('useTelemetryStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));

    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads as idle where the console holds no stream open', () => {
    const telemetryStore = useTelemetryStore();

    expect(telemetryStore.state).toBe('idle');
    expect(telemetryStore.ageSeconds).toBeNull();
  });

  it('reads as live while a connected stream keeps reporting', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(true, new Date()));

    vi.advanceTimersByTime(5000);

    expect(telemetryStore.state).toBe('live');
    expect(telemetryStore.ageSeconds).toBe(5);
  });

  it('reads as stale once a stream has missed its freshness window', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(true, new Date()));

    vi.advanceTimersByTime(Config.SSE_STALE_MS);

    expect(telemetryStore.state).toBe('stale');
  });

  it('reads as stale while a stream is disconnected, however recently it spoke', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(false, new Date()));

    expect(telemetryStore.state).toBe('stale');
  });

  it('lets no healthy stream mask a stale one', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(true, new Date()));
    telemetryStore.register(stream(false, new Date()));

    expect(telemetryStore.state).toBe('stale');
  });

  it('ages from the stream that has been quiet longest', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(true, new Date(Date.now() - 30000)));
    telemetryStore.register(stream(true, new Date()));

    expect(telemetryStore.ageSeconds).toBe(30);
  });

  it('has no age until a stream has reported', () => {
    const telemetryStore = useTelemetryStore();
    telemetryStore.register(stream(false, null));

    expect(telemetryStore.state).toBe('stale');
    expect(telemetryStore.ageSeconds).toBeNull();
  });

  it('falls back to idle once the last stream deregisters', () => {
    const telemetryStore = useTelemetryStore();
    const deregister = telemetryStore.register(stream(true, new Date()));

    deregister();

    expect(telemetryStore.state).toBe('idle');
  });

  it('tracks each registration separately, so one closing leaves the other', () => {
    const telemetryStore = useTelemetryStore();
    const tracked = stream(true, new Date());

    const deregister = telemetryStore.register(tracked);
    telemetryStore.register(tracked);
    deregister();

    expect(telemetryStore.state).toBe('live');
  });

  it('stops ticking once no stream is left to age', () => {
    const telemetryStore = useTelemetryStore();
    const deregister = telemetryStore.register(stream(true, new Date()));

    deregister();

    expect(vi.getTimerCount()).toBe(0);
  });

  describe('one stream', () => {
    it('reads a stream not open yet as idle', () => {
      const telemetryStore = useTelemetryStore();

      expect(telemetryStore.stateOf(null)).toBe('idle');
    });

    it('reads one quiet stream as stale while another stays live', () => {
      const telemetryStore = useTelemetryStore();
      const quiet = stream(true, new Date());
      const busy = stream(true, new Date());

      telemetryStore.register(quiet);
      telemetryStore.register(busy);

      vi.advanceTimersByTime(Config.SSE_STALE_MS + 1000);
      busy.lastActivityDate.value = new Date();
      vi.advanceTimersByTime(1000);

      expect(telemetryStore.stateOf(quiet)).toBe('stale');
      expect(telemetryStore.stateOf(busy)).toBe('live');
    });
  });
});
