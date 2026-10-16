import { z } from 'zod';

import { DOWNLOAD_TOKEN_PATTERN, RELAY_MAX_LOG_TAIL } from '@libs/agent-protocol';
import { blankAsAbsent, cron, duration, flag, integer, NodeEnv, secret, text } from '@libs/runtime';

/** Keyed by the variable each setting is read from, so a rejected value names itself. */
export const environment = z.object({
  // General
  VERSION: text('0.0.0'),

  NODE_ENV: z.enum(NodeEnv).default(NodeEnv.DEVELOPMENT),
  PORT: integer(3000),

  WEB_APP_BASE_URL: z.string().min(1),

  // Directory holding the built web app. Blank turns web app serving off.
  WEB_ROOT_PATH: z.string().default(''),

  BLOCKED_AT_ENABLED: flag(false),
  BLOCKED_AT_THRESHOLD_MS: integer(1000),

  PAGE_SIZE: integer(20, 1),

  /** Express's `trust proxy`: a hop count, true, false, or comma-separated addresses, subnets or named ranges. */
  TRUST_PROXY: text('false'),

  // Logs
  LOG_STDOUT_LEVEL: text('info'),
  LOG_STDOUT_PRETTY: flag(true),

  LOG_FILE_LEVEL: text('info'),
  LOG_FILE_PRETTY: flag(true),
  // Blank turns file logging off.
  LOG_FILE_PATH: z.string().default('logs'),
  LOG_FILE_NAME: text('all.log'),
  LOG_FILE_ROTATE_INTERVAL: text('1d'),
  LOG_FILE_ROTATE_MAX_SIZE: text('10M'),
  LOG_FILE_ROTATE_MAX_FILES: integer(5, 1),

  // Database
  TYPEORM_HOST: z.string().min(1),
  TYPEORM_PORT: integer(5432),
  TYPEORM_USERNAME: text('modelfleet'),
  TYPEORM_PASSWORD: z.string().min(1),
  TYPEORM_DATABASE: text('modelfleet'),
  TYPEORM_LOGGING: flag(false),
  TYPEORM_MIGRATIONS_RUN: flag(false),
  TYPEORM_USE_SSL: flag(false),

  USE_TEST_MIGRATIONS: flag(false),

  // Email
  EMAIL_TEMPLATES_PATH: text('email-templates'),

  EMAIL_FROM_ADDRESS: z.string().min(1),

  EMAIL_SMTP_HOST: z.string().default(''),
  EMAIL_SMTP_PORT: integer(587),
  EMAIL_SMTP_USERNAME: z.string().default(''),
  EMAIL_SMTP_PASSWORD: z.string().default(''),
  // Implicit TLS, as on port 465. Port 587 expects false and STARTTLS.
  EMAIL_SMTP_SECURE: flag(false),
  EMAIL_SMTP_STARTTLS: flag(true),

  EMAIL_SES_REGION: text('eu-west-2'),
  EMAIL_SES_ACCESS_KEY_ID: z.string().default(''),
  EMAIL_SES_SECRET_ACCESS_KEY: z.string().default(''),

  // Rate limiting
  RATE_LIMIT_WINDOW_SECS: integer(5, 1),
  RATE_LIMIT_MAX_REQUESTS: integer(50, 1),

  // Requests
  REQUEST_MAX_SIZE_JSON: text('8mb'),

  // Gateway
  GATEWAY_PORT: integer(3030),

  GATEWAY_REQUEST_MAX_SIZE_JSON: text('32mb'),

  /** OpenAI's and vLLM's own cap on a transcription upload. */
  GATEWAY_REQUEST_MAX_SIZE_AUDIO: text('25mb'),

  GATEWAY_RATE_LIMIT_WINDOW_SECS: integer(60, 1),
  GATEWAY_RATE_LIMIT_MAX_REQUESTS: integer(600, 1),
  GATEWAY_RATE_LIMIT_MAX_REQUESTS_PER_ADDRESS: integer(6000, 1),

  /** Sits above the relay's own headers timeout, so the node's account of a failure arrives rather than this one. */
  GATEWAY_UPSTREAM_HEADERS_TIMEOUT: duration('60s'),

  /** Sits above the agent's own launch timeout for a large model, so a slow load fails there rather than here. */
  GATEWAY_LOAD_WAIT_TIMEOUT: duration('15m'),

  // User
  USER_TOKEN_SECRET: secret(),
  USER_TOKEN_EXPIRY: duration('24h'),

  USER_PASSWORD_HASH_ROUNDS: integer(8),

  USER_IDLE_TIMEOUT: duration('1h'),

  // Node
  NODE_SECRET_HASH_ROUNDS: integer(8),

  NODE_OFFLINE_THRESHOLD: duration('30s'),

  /** Named in the welcome, so the interval an agent keeps is the one the server asked for. */
  NODE_HEARTBEAT_INTERVAL: duration('10s'),

  NODE_HANDSHAKE_TIMEOUT: duration('10s'),

  // Scheduler
  /** How long an onDemand deployment may idle before it is stopped, unless its document names its own. */
  SCHEDULER_IDLE_TIMEOUT: duration('15m'),

  /** Starts that may fail in a row before a deployment is given up on, until an operator starts it by hand. */
  SCHEDULER_LAUNCH_FAILURE_LIMIT: integer(10, 1),

  // Instance output
  INSTANCE_OUTPUT_TAIL_LINES: integer(1000, 1, RELAY_MAX_LOG_TAIL),

  // Batch jobs
  /** Failed runs kept per job. A job keeps fewer of its successful runs. */
  BATCH_JOB_RUN_HISTORY_SIZE: integer(100, 1),

  BATCH_JOB_RESIDENCY_CRON: cron('*/30 * * * * *'),

  // Downloads
  /** Read by the server for a repository's files, and handed to each node to fetch them from. */
  HUGGINGFACE_ENDPOINT: z.url({ protocol: /^https?$/ }).default('https://huggingface.co'),

  /** Sent with every Hub read and handed to each node to fetch with. Blank reads public repositories alone. */
  HUGGINGFACE_TOKEN: blankAsAbsent(
    z
      .string()
      .startsWith('hf_', { error: 'must start hf_, as the Hub client refuses any other' })
      .regex(DOWNLOAD_TOKEN_PATTERN, { error: 'must be printable ASCII with no whitespace' })
      .optional()
  ),
});

export type IEnvConfig = z.infer<typeof environment>;

/** Settings whose value never reaches a log or an error message. */
export const SECRETS: readonly (keyof IEnvConfig)[] = [
  'USER_TOKEN_SECRET',
  'TYPEORM_PASSWORD',
  'EMAIL_SMTP_PASSWORD',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'HUGGINGFACE_TOKEN',
];
