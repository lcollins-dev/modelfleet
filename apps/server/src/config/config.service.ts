import { Injectable } from '@nestjs/common';
import ms from 'ms';

import { maskSecrets, parseEnvironment } from '@libs/runtime';

import { environment, type IEnvConfig, SECRETS } from './config.schema';

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

  get port() {
    return this.env.PORT;
  }

  get webAppBaseUrl() {
    return this.env.WEB_APP_BASE_URL;
  }

  get webRootPath() {
    return this.env.WEB_ROOT_PATH;
  }

  get blockedAtEnabled() {
    return this.env.BLOCKED_AT_ENABLED;
  }

  get blockedAtThresholdMs() {
    return this.env.BLOCKED_AT_THRESHOLD_MS;
  }

  get pageSize() {
    return this.env.PAGE_SIZE;
  }

  /** Express reads a string as a list of addresses, so a hop count and a boolean are passed as their own types. */
  get trustProxy(): boolean | number | string {
    const setting = this.env.TRUST_PROXY.trim();

    if (/^\d+$/.test(setting)) {
      return Number(setting);
    }

    if (setting === 'true' || setting === 'false') {
      return setting === 'true';
    }

    return setting;
  }

  // Logs
  get logStdoutLevel() {
    return this.env.LOG_STDOUT_LEVEL;
  }

  get logStdoutPretty() {
    return this.env.LOG_STDOUT_PRETTY;
  }

  get logFileLevel() {
    return this.env.LOG_FILE_LEVEL;
  }

  get logFilePretty() {
    return this.env.LOG_FILE_PRETTY;
  }

  get logFilePath() {
    return this.env.LOG_FILE_PATH;
  }

  get logFileName() {
    return this.env.LOG_FILE_NAME;
  }

  get logFileRotateInterval() {
    return this.env.LOG_FILE_ROTATE_INTERVAL;
  }

  get logFileRotateMaxSize() {
    return this.env.LOG_FILE_ROTATE_MAX_SIZE;
  }

  get logFileRotateMaxFiles() {
    return this.env.LOG_FILE_ROTATE_MAX_FILES;
  }

  // Email
  get emailTemplatesPath() {
    return this.env.EMAIL_TEMPLATES_PATH;
  }

  get emailFromAddress() {
    return this.env.EMAIL_FROM_ADDRESS;
  }

  get emailSmtpHost() {
    return this.env.EMAIL_SMTP_HOST;
  }

  get emailSmtpPort() {
    return this.env.EMAIL_SMTP_PORT;
  }

  get emailSmtpUsername() {
    return this.env.EMAIL_SMTP_USERNAME;
  }

  get emailSmtpPassword() {
    return this.env.EMAIL_SMTP_PASSWORD;
  }

  get emailSmtpSecure() {
    return this.env.EMAIL_SMTP_SECURE;
  }

  get emailSmtpStarttls() {
    return this.env.EMAIL_SMTP_STARTTLS;
  }

  get emailSesRegion() {
    return this.env.EMAIL_SES_REGION;
  }

  get emailSesAccessKeyId() {
    return this.env.EMAIL_SES_ACCESS_KEY_ID;
  }

  get emailSesSecretAccessKey() {
    return this.env.EMAIL_SES_SECRET_ACCESS_KEY;
  }

  // Database
  get typeormHost() {
    return this.env.TYPEORM_HOST;
  }

  get typeormPort() {
    return this.env.TYPEORM_PORT;
  }

  get typeormUsername() {
    return this.env.TYPEORM_USERNAME;
  }

  get typeormPassword() {
    return this.env.TYPEORM_PASSWORD;
  }

  get typeormDatabase() {
    return this.env.TYPEORM_DATABASE;
  }

  get typeormMigrationsRun() {
    return this.env.TYPEORM_MIGRATIONS_RUN;
  }

  get typeormLogging() {
    return this.env.TYPEORM_LOGGING;
  }

  get typeormUseSSL() {
    return this.env.TYPEORM_USE_SSL;
  }

  get useTestMigrations() {
    return this.env.USE_TEST_MIGRATIONS;
  }

  // Rate limiting
  get rateLimitWindowSecs() {
    return this.env.RATE_LIMIT_WINDOW_SECS;
  }

  get rateLimitMaxRequests() {
    return this.env.RATE_LIMIT_MAX_REQUESTS;
  }

  // Requests
  get requestMaxSizeJson() {
    return this.env.REQUEST_MAX_SIZE_JSON;
  }

  // Gateway
  get gatewayPort() {
    return this.env.GATEWAY_PORT;
  }

  get gatewayRequestMaxSizeJson() {
    return this.env.GATEWAY_REQUEST_MAX_SIZE_JSON;
  }

  get gatewayRequestMaxSizeAudio() {
    return this.env.GATEWAY_REQUEST_MAX_SIZE_AUDIO;
  }

  get gatewayUpstreamHeadersTimeoutMs() {
    return ms(this.env.GATEWAY_UPSTREAM_HEADERS_TIMEOUT);
  }

  get gatewayLoadWaitTimeoutMs() {
    return ms(this.env.GATEWAY_LOAD_WAIT_TIMEOUT);
  }

  get gatewayRateLimitWindowSecs() {
    return this.env.GATEWAY_RATE_LIMIT_WINDOW_SECS;
  }

  get gatewayRateLimitMaxRequests() {
    return this.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS;
  }

  get gatewayRateLimitMaxRequestsPerAddress() {
    return this.env.GATEWAY_RATE_LIMIT_MAX_REQUESTS_PER_ADDRESS;
  }

  // User
  get userTokenSecret() {
    return this.env.USER_TOKEN_SECRET;
  }

  get userTokenExpiry() {
    return this.env.USER_TOKEN_EXPIRY;
  }

  get userPasswordHashRounds() {
    return this.env.USER_PASSWORD_HASH_ROUNDS;
  }

  get userIdleTimeoutMs() {
    return ms(this.env.USER_IDLE_TIMEOUT);
  }

  // Node
  get nodeSecretHashRounds() {
    return this.env.NODE_SECRET_HASH_ROUNDS;
  }

  get nodeOfflineThresholdMs() {
    return ms(this.env.NODE_OFFLINE_THRESHOLD);
  }

  get nodeHeartbeatIntervalMs() {
    return ms(this.env.NODE_HEARTBEAT_INTERVAL);
  }

  get nodeHandshakeTimeoutMs() {
    return ms(this.env.NODE_HANDSHAKE_TIMEOUT);
  }

  // Scheduler
  get schedulerIdleTimeoutMs() {
    return ms(this.env.SCHEDULER_IDLE_TIMEOUT);
  }

  get schedulerLaunchFailureLimit() {
    return this.env.SCHEDULER_LAUNCH_FAILURE_LIMIT;
  }

  // Instance output
  get instanceOutputTailLines() {
    return this.env.INSTANCE_OUTPUT_TAIL_LINES;
  }

  // Batch jobs
  get batchJobRunHistorySize() {
    return this.env.BATCH_JOB_RUN_HISTORY_SIZE;
  }

  get batchJobResidencyCron() {
    return this.env.BATCH_JOB_RESIDENCY_CRON;
  }

  // Downloads
  get huggingfaceEndpoint() {
    return this.env.HUGGINGFACE_ENDPOINT;
  }

  get huggingfaceToken(): string | null {
    return this.env.HUGGINGFACE_TOKEN ?? null;
  }
}
