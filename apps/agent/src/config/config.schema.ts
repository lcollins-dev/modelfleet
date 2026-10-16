import { z } from 'zod';

import { MAX_AGENT_VERSION_LENGTH, MAX_NODE_SECRET_LENGTH } from '@libs/agent-protocol';
import { blankAsAbsent, duration, integer, list, NodeEnv, ratio, text } from '@libs/runtime';

import { isDialable } from '../server/server-url';

export const environment = z.object({
  // General
  VERSION: blankAsAbsent(z.string().max(MAX_AGENT_VERSION_LENGTH).default('0.0.0')),

  NODE_ENV: z.enum(NodeEnv).default(NodeEnv.DEVELOPMENT),

  // Logs
  LOG_LEVEL: text('info'),

  // Server
  SERVER_URL: z.string().refine(isDialable, { message: 'must be an http, https, ws or wss URL' }),

  // Node identity, issued when an operator registers this node
  NODE_KEY: z.uuid(),
  NODE_SECRET: z.string().min(1).max(MAX_NODE_SECRET_LENGTH),

  // Reconnection
  RECONNECT_INITIAL_DELAY: duration('1s'),
  RECONNECT_MAX_DELAY: duration('30s'),
  RECONNECT_JITTER_RATIO: ratio(0.2),

  CONNECT_TIMEOUT: duration('10s'),

  // Reconciliation
  RECONCILE_INTERVAL: duration('10s'),

  // Docker
  DOCKER_SOCKET_PATH: text('/var/run/docker.sock'),

  // Instances
  /** The Docker network the agent shares with the backends it runs. Nothing outside it reaches one. */
  INSTANCE_NETWORK: text('modelfleet-instances'),

  INSTANCE_START_TIMEOUT_BASE: duration('2m'),
  INSTANCE_START_TIMEOUT_PER_GIB: duration('20s'),

  INSTANCE_PROBE_TIMEOUT: duration('2s'),
  INSTANCE_PROBE_INITIAL_DELAY: duration('500ms'),
  INSTANCE_PROBE_MAX_DELAY: duration('5s'),
  INSTANCE_PROBE_JITTER_RATIO: ratio(0.2),

  /** Lines of the backend's own output kept against a launch that failed. */
  INSTANCE_LOG_TAIL_LINES: integer(30, 0),

  /** Left free on each card when the server admits a start, matching llama.cpp's own `--fit-target` default. */
  GPU_HEADROOM_MIB: integer(1024, 0),

  // Inference relay
  RELAY_PORT: integer(3040),

  /** Blank advertises loopback on `RELAY_PORT`, which is where a server on this host reaches it. */
  RELAY_ADVERTISE_URL: text(''),

  /** Bounds the wait for a backend's status line alone. A response already streaming is never cut short. */
  RELAY_HEADERS_TIMEOUT: duration('30s'),

  // Models
  MODEL_DIRS: list([]),

  // Downloads
  /** A body that delivers nothing for this long is dropped and fetched again from where it stopped. */
  DOWNLOAD_STALL_TIMEOUT: duration('60s'),

  /** Attempts in a row that fetch nothing before a file, and the download it belongs to, fails. */
  DOWNLOAD_RETRY_LIMIT: integer(5, 1),
  DOWNLOAD_RETRY_INITIAL_DELAY: duration('2s'),
  DOWNLOAD_RETRY_MAX_DELAY: duration('60s'),

  // Telemetry
  GPU_READER_PATH: text('mf-gpu'),
  GPU_READER_INTERVAL: duration('5s'),

  TELEMETRY_RESTART_INITIAL_DELAY: duration('1s'),
  TELEMETRY_RESTART_MAX_DELAY: duration('60s'),
  TELEMETRY_RESTART_JITTER_RATIO: ratio(0.2),

  /** Consecutive failed readings before the node's telemetry is called degraded. */
  TELEMETRY_DEGRADED_AFTER: integer(3, 1),

  TELEMETRY_ATTRIBUTION_MAX_AGE: duration('30s'),
});

export type IEnvConfig = z.infer<typeof environment>;

export const SECRETS: readonly (keyof IEnvConfig)[] = ['NODE_SECRET'];
