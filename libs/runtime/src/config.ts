import { validateCronExpression } from 'cron';
import { type StringValue } from 'ms';
import { existsSync } from 'node:fs';
import { z } from 'zod';

export function blankAsAbsent<TSchema extends z.ZodType>(schema: TSchema) {
  return z.preprocess(value => (typeof value === 'string' && value.trim().length === 0 ? undefined : value), schema);
}

export function integer(fallback: number, min?: number, max?: number) {
  const schema = z.coerce.number().int();
  const atLeast = min === undefined ? schema : schema.min(min);

  return blankAsAbsent((max === undefined ? atLeast : atLeast.max(max)).default(fallback));
}

export function text(fallback: string) {
  return blankAsAbsent(z.string().default(fallback));
}

export const SECRET_MIN_LENGTH = 32;

export function secret() {
  const error = `must be at least ${SECRET_MIN_LENGTH} characters - generate one with \`openssl rand -hex 32\``;

  return blankAsAbsent(z.string({ error }).min(SECRET_MIN_LENGTH, { error }));
}

/** Reads a comma-separated value, dropping blank entries. */
export function list(fallback: readonly string[]) {
  return blankAsAbsent(
    z
      .string()
      .default(fallback.join(','))
      .transform(value =>
        value
          .split(',')
          .map(entry => entry.trim())
          .filter(entry => entry.length > 0)
      )
  );
}

const DURATION_VALUE_PATTERN = /^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|years?|msecs?)?$/i;

/** A span `ms` can read, a bare number among them as milliseconds. */
export function durationValue() {
  return z.custom<StringValue>(value => typeof value === 'string' && DURATION_VALUE_PATTERN.test(value), {
    message: 'must be a duration such as 24h, 30m or 1500ms',
  });
}

const DURATION_PATTERN = /^(0|\d+(\.\d+)?\s*(ms|s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|years?|msecs?))$/i;

/** A span with a unit, e.g. `24h`, or `0`; `ms` reads a bare number as milliseconds. */
export function duration(fallback: StringValue) {
  return blankAsAbsent(
    z
      .custom<StringValue>(value => typeof value === 'string' && DURATION_PATTERN.test(value), {
        message: 'must be a duration with a unit, such as 24h, 30m or 1500ms, or 0',
      })
      .default(fallback)
  );
}

export function cron(fallback: string) {
  return blankAsAbsent(
    z
      .string()
      .refine(value => validateCronExpression(value).valid, { message: 'must be a cron expression such as 17 * * * *' })
      .default(fallback)
  );
}

export function flag(fallback: boolean) {
  return blankAsAbsent(
    z.preprocess(
      value => (typeof value === 'string' ? value.toLowerCase() : value),
      z
        .enum(['true', 'false'])
        .default(fallback ? 'true' : 'false')
        .transform(value => value === 'true')
    )
  );
}

export function ratio(fallback: number) {
  return blankAsAbsent(z.coerce.number().min(0).max(1).default(fallback));
}

export enum NodeEnv {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Reads `<NODE_ENV>.env` into `process.env`, leaving any variable already set. A missing file is accepted. */
function loadEnvFile(nodeEnv: string): void {
  const path = `${nodeEnv}.env`;

  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

function configError(issues: readonly z.core.$ZodIssue[]): ConfigError {
  const reasons = issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');

  return new ConfigError(`Config validation error: ${reasons}`);
}

/** Loads `<NODE_ENV>.env` into `process.env` first. */
export function parseEnvironment<TSchema extends z.ZodType>(schema: TSchema): z.infer<TSchema> {
  loadEnvFile(process.env.NODE_ENV ?? NodeEnv.DEVELOPMENT);

  const validated = schema.safeParse(process.env);

  if (!validated.success) {
    throw configError(validated.error.issues);
  }

  return validated.data;
}

export function maskSecrets<TEnv extends Record<string, unknown>>(
  env: TEnv,
  secrets: readonly (keyof TEnv)[]
): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...env };

  for (const secret of secrets) {
    masked[String(secret)] = '[redacted]';
  }

  return masked;
}
