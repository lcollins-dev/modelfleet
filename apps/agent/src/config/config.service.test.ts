import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_AGENT_VERSION_LENGTH, MAX_NODE_SECRET_LENGTH } from '@libs/agent-protocol';
import { ConfigError } from '@libs/runtime';

import { ConfigService } from '@/config/config.service';

const NODE_SECRET = 'a-node-secret';

describe('ConfigService', () => {
  beforeEach(() => {
    vi.stubEnv('SERVER_URL', 'http://server.test');
    vi.stubEnv('NODE_KEY', '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b');
    vi.stubEnv('NODE_SECRET', NODE_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hands a duration back in milliseconds', () => {
    vi.stubEnv('CONNECT_TIMEOUT', '2m');

    expect(new ConfigService().connectTimeoutMs).toBe(120_000);
  });

  it('hands back each backoff from its own settings, ready to use', () => {
    vi.stubEnv('RECONNECT_INITIAL_DELAY', '500ms');
    vi.stubEnv('RECONNECT_MAX_DELAY', '1m');
    vi.stubEnv('RECONNECT_JITTER_RATIO', '0.5');
    vi.stubEnv('INSTANCE_PROBE_INITIAL_DELAY', '100ms');
    vi.stubEnv('INSTANCE_PROBE_MAX_DELAY', '2s');
    vi.stubEnv('INSTANCE_PROBE_JITTER_RATIO', '0.1');
    vi.stubEnv('TELEMETRY_RESTART_INITIAL_DELAY', '3s');
    vi.stubEnv('TELEMETRY_RESTART_MAX_DELAY', '4m');
    vi.stubEnv('TELEMETRY_RESTART_JITTER_RATIO', '0.3');
    vi.stubEnv('DOWNLOAD_RETRY_INITIAL_DELAY', '5s');
    vi.stubEnv('DOWNLOAD_RETRY_MAX_DELAY', '6m');

    const configService = new ConfigService();

    expect(configService.reconnectBackoff).toEqual({ initialDelayMs: 500, maxDelayMs: 60_000, jitterRatio: 0.5 });
    expect(configService.instanceProbeBackoff).toEqual({ initialDelayMs: 100, maxDelayMs: 2000, jitterRatio: 0.1 });
    expect(configService.telemetryRestartBackoff).toEqual({
      initialDelayMs: 3000,
      maxDelayMs: 240_000,
      jitterRatio: 0.3,
    });
    expect(configService.downloadRetryBackoff).toEqual({ initialDelayMs: 5000, maxDelayMs: 360_000, jitterRatio: 0.2 });
  });

  it('reads a blank jitter ratio as its default', () => {
    vi.stubEnv('INSTANCE_PROBE_JITTER_RATIO', '');

    expect(new ConfigService().instanceProbeBackoff.jitterRatio).toBe(0.2);
  });

  it('masks the node secret in the settings it logs, and keeps durations as they were written', () => {
    vi.stubEnv('RECONCILE_INTERVAL', '10s');

    const loggable = new ConfigService().loggable;

    expect(loggable.NODE_SECRET).toBe('[redacted]');
    expect(loggable.RECONCILE_INTERVAL).toBe('10s');
    expect(JSON.stringify(loggable)).not.toContain(NODE_SECRET);
  });

  it.each([
    ['NODE_SECRET', 's'.repeat(MAX_NODE_SECRET_LENGTH + 1)],
    ['VERSION', 'v'.repeat(MAX_AGENT_VERSION_LENGTH + 1)],
  ])('refuses to start on a %s longer than the hello carries', (name, value) => {
    vi.stubEnv(name, value);

    expect(() => new ConfigService()).toThrow(ConfigError);
  });
});
