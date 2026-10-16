import { Injectable } from '@nestjs/common';
import ms from 'ms';

import { maskSecrets, parseEnvironment } from '@libs/runtime';

import { type IBackoffOptions } from '../common/backoff';
import { environment, type IEnvConfig, SECRETS } from './config.schema';

const DOWNLOAD_RETRY_JITTER_RATIO = 0.2;

@Injectable()
export class ConfigService {
  private readonly env: IEnvConfig;

  constructor() {
    this.env = parseEnvironment(environment);
  }

  /** The validated settings with every secret masked, safe to log. */
  get loggable(): Record<string, unknown> {
    return maskSecrets(this.env, SECRETS);
  }

  // General
  get version() {
    return this.env.VERSION;
  }

  get nodeEnv() {
    return this.env.NODE_ENV;
  }

  // Logs
  get logLevel() {
    return this.env.LOG_LEVEL;
  }

  // Server
  get serverUrl() {
    return this.env.SERVER_URL;
  }

  // Node
  get nodeKey() {
    return this.env.NODE_KEY;
  }

  get nodeSecret() {
    return this.env.NODE_SECRET;
  }

  // Reconnection
  get reconnectBackoff(): IBackoffOptions {
    return {
      initialDelayMs: ms(this.env.RECONNECT_INITIAL_DELAY),
      maxDelayMs: ms(this.env.RECONNECT_MAX_DELAY),
      jitterRatio: this.env.RECONNECT_JITTER_RATIO,
    };
  }

  get connectTimeoutMs() {
    return ms(this.env.CONNECT_TIMEOUT);
  }

  // Reconciliation
  get reconcileIntervalMs() {
    return ms(this.env.RECONCILE_INTERVAL);
  }

  // Docker
  get dockerSocketPath() {
    return this.env.DOCKER_SOCKET_PATH;
  }

  // Instances
  get instanceNetwork() {
    return this.env.INSTANCE_NETWORK;
  }

  get instanceStartTimeoutBaseMs() {
    return ms(this.env.INSTANCE_START_TIMEOUT_BASE);
  }

  get instanceStartTimeoutPerGibMs() {
    return ms(this.env.INSTANCE_START_TIMEOUT_PER_GIB);
  }

  get gpuHeadroomBytes() {
    return this.env.GPU_HEADROOM_MIB * 1024 * 1024;
  }

  get instanceProbeTimeoutMs() {
    return ms(this.env.INSTANCE_PROBE_TIMEOUT);
  }

  get instanceProbeBackoff(): IBackoffOptions {
    return {
      initialDelayMs: ms(this.env.INSTANCE_PROBE_INITIAL_DELAY),
      maxDelayMs: ms(this.env.INSTANCE_PROBE_MAX_DELAY),
      jitterRatio: this.env.INSTANCE_PROBE_JITTER_RATIO,
    };
  }

  get instanceLogTailLines() {
    return this.env.INSTANCE_LOG_TAIL_LINES;
  }

  // Inference relay
  get relayPort() {
    return this.env.RELAY_PORT;
  }

  get relayAdvertiseUrl(): string {
    const configured = this.env.RELAY_ADVERTISE_URL;

    return configured.length > 0 ? configured : `http://localhost:${this.env.RELAY_PORT}`;
  }

  get relayHeadersTimeoutMs() {
    return ms(this.env.RELAY_HEADERS_TIMEOUT);
  }

  // Models
  get modelDirs() {
    return this.env.MODEL_DIRS;
  }

  // Downloads
  /** As the operator wrote it, for a message that names it. */
  get downloadStallTimeout() {
    return this.env.DOWNLOAD_STALL_TIMEOUT;
  }

  get downloadStallTimeoutMs() {
    return ms(this.env.DOWNLOAD_STALL_TIMEOUT);
  }

  get downloadRetryLimit() {
    return this.env.DOWNLOAD_RETRY_LIMIT;
  }

  get downloadRetryBackoff(): IBackoffOptions {
    return {
      initialDelayMs: ms(this.env.DOWNLOAD_RETRY_INITIAL_DELAY),
      maxDelayMs: ms(this.env.DOWNLOAD_RETRY_MAX_DELAY),
      jitterRatio: DOWNLOAD_RETRY_JITTER_RATIO,
    };
  }

  // Telemetry
  get gpuReaderPath() {
    return this.env.GPU_READER_PATH;
  }

  get gpuReaderIntervalMs() {
    return ms(this.env.GPU_READER_INTERVAL);
  }

  get telemetryRestartBackoff(): IBackoffOptions {
    return {
      initialDelayMs: ms(this.env.TELEMETRY_RESTART_INITIAL_DELAY),
      maxDelayMs: ms(this.env.TELEMETRY_RESTART_MAX_DELAY),
      jitterRatio: this.env.TELEMETRY_RESTART_JITTER_RATIO,
    };
  }

  get telemetryDegradedAfter() {
    return this.env.TELEMETRY_DEGRADED_AFTER;
  }

  get telemetryAttributionMaxAgeMs() {
    return ms(this.env.TELEMETRY_ATTRIBUTION_MAX_AGE);
  }
}
