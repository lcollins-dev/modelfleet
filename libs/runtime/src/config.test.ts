import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ConfigError,
  cron,
  duration,
  durationValue,
  flag,
  integer,
  list,
  maskSecrets,
  parseEnvironment,
  ratio,
  secret,
  text,
} from './config';

describe('integer', () => {
  const schema = z.object({ VALUE: integer(7) });

  it('coerces the string an environment holds', () => {
    expect(schema.parse({ VALUE: '42' })).toEqual({ VALUE: 42 });
  });

  it('falls back on an absent value', () => {
    expect(schema.parse({})).toEqual({ VALUE: 7 });
  });

  it('falls back on a blank value, rather than reading it as zero', () => {
    expect(schema.parse({ VALUE: '   ' })).toEqual({ VALUE: 7 });
  });

  it('rejects a value that is not a number', () => {
    expect(schema.safeParse({ VALUE: 'soon' }).success).toBe(false);
  });

  it('accepts a value at its minimum', () => {
    expect(integer(100, 1).parse('1')).toBe(1);
  });

  it('refuses a value below its minimum', () => {
    expect(integer(100, 1).safeParse('0').success).toBe(false);
  });

  it('accepts any integer without a minimum', () => {
    expect(integer(5).parse('-3')).toBe(-3);
  });

  it('accepts a value at its maximum', () => {
    expect(integer(100, 0, 200).parse('200')).toBe(200);
  });

  it('refuses a value above its maximum', () => {
    expect(integer(100, 0, 200).safeParse('201').success).toBe(false);
  });
});

describe('text', () => {
  const schema = z.object({ VALUE: text('fallback') });

  it('keeps the value it was given', () => {
    expect(schema.parse({ VALUE: 'set' })).toEqual({ VALUE: 'set' });
  });

  it('falls back on a blank value, rather than reaching the app as an empty string', () => {
    expect(schema.parse({ VALUE: '' })).toEqual({ VALUE: 'fallback' });
  });
});

describe('secret', () => {
  const schema = z.object({ VALUE: secret() });
  const refusal = 'must be at least 32 characters - generate one with `openssl rand -hex 32`';

  it('accepts a value of exactly 32 characters', () => {
    expect(schema.parse({ VALUE: 'a'.repeat(32) })).toEqual({ VALUE: 'a'.repeat(32) });
  });

  it.each([
    ['31 characters', { VALUE: 'a'.repeat(31) }],
    ['a blank value', { VALUE: '  ' }],
    ['an absent value', {}],
  ])('refuses %s with the openssl hint', (_case, environment) => {
    const parsed = schema.safeParse(environment);

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe(refusal);
  });
});

describe('duration', () => {
  const schema = z.object({ VALUE: duration('24h') });

  it('accepts every unit ms reads', () => {
    for (const span of ['1500ms', '30s', '10m', '24h', '7d', '2w', '1y']) {
      expect(schema.parse({ VALUE: span })).toEqual({ VALUE: span });
    }
  });

  it('accepts 0 without a unit', () => {
    expect(schema.parse({ VALUE: '0' })).toEqual({ VALUE: '0' });
  });

  it('refuses a number without a unit, which ms would read as milliseconds', () => {
    const parsed = schema.safeParse({ VALUE: '1500' });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe('must be a duration with a unit, such as 24h, 30m or 1500ms, or 0');
  });

  it('rejects a span in a notation ms cannot read', () => {
    expect(schema.safeParse({ VALUE: '30 fortnights' }).success).toBe(false);
  });

  it('falls back on a blank value', () => {
    expect(schema.parse({ VALUE: '' })).toEqual({ VALUE: '24h' });
  });
});

describe('durationValue', () => {
  it('accepts a bare number of milliseconds', () => {
    expect(durationValue().parse('1500')).toBe('1500');
  });

  it('rejects a span in a notation ms cannot read', () => {
    expect(durationValue().safeParse('30 fortnights').success).toBe(false);
  });
});

describe('cron', () => {
  it('falls back on a blank value', () => {
    expect(cron('0 * * * *').parse('  ')).toBe('0 * * * *');
  });

  it('accepts a cron expression', () => {
    expect(cron('0 * * * *').parse('17 3 * * 1')).toBe('17 3 * * 1');
  });

  it('accepts a cron expression with a seconds field', () => {
    expect(cron('0 * * * *').parse('*/30 * * * * *')).toBe('*/30 * * * * *');
  });

  it('refuses a value that is not a cron expression', () => {
    const parsed = cron('0 * * * *').safeParse('every hour');

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0].message).toBe('must be a cron expression such as 17 * * * *');
  });
});

describe('flag', () => {
  const schema = z.object({ VALUE: flag(false) });

  it('reads a flag however it is cased', () => {
    expect(schema.parse({ VALUE: 'TRUE' })).toEqual({ VALUE: true });
    expect(schema.parse({ VALUE: 'False' })).toEqual({ VALUE: false });
  });

  it('falls back on a blank value', () => {
    expect(schema.parse({ VALUE: '  ' })).toEqual({ VALUE: false });
  });

  it('rejects a value that is neither true nor false', () => {
    expect(schema.safeParse({ VALUE: 'yes' }).success).toBe(false);
  });
});

describe('list', () => {
  const schema = z.object({ VALUE: list(['/weights']) });

  it('splits a comma-separated value and trims each entry', () => {
    expect(schema.parse({ VALUE: '/a, /b ,/c' })).toEqual({ VALUE: ['/a', '/b', '/c'] });
  });

  it('drops a blank entry, so a trailing comma costs nothing', () => {
    expect(schema.parse({ VALUE: '/a,,/b,' })).toEqual({ VALUE: ['/a', '/b'] });
  });

  it('falls back on a blank value', () => {
    expect(schema.parse({ VALUE: '  ' })).toEqual({ VALUE: ['/weights'] });
  });

  it('reads an empty fallback as no entries at all', () => {
    expect(z.object({ VALUE: list([]) }).parse({})).toEqual({ VALUE: [] });
  });
});

describe('ratio', () => {
  it('reads a fraction', () => {
    expect(ratio(0.2).parse('0.5')).toBe(0.5);
  });

  it('falls back on a blank value, rather than reading it as zero', () => {
    expect(ratio(0.2).parse(' ')).toBe(0.2);
  });

  it('refuses a value above one', () => {
    expect(ratio(0.2).safeParse('1.5').success).toBe(false);
  });

  it('refuses a value below zero', () => {
    expect(ratio(0.2).safeParse('-0.1').success).toBe(false);
  });
});

describe('parseEnvironment', () => {
  const schema = z.object({ NODE_ENV: z.string(), PARSE_ENVIRONMENT_VALUE: integer(7, 1) });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the environment through the schema', () => {
    vi.stubEnv('NODE_ENV', 'parse-environment-test');
    vi.stubEnv('PARSE_ENVIRONMENT_VALUE', '42');

    expect(parseEnvironment(schema)).toEqual({ NODE_ENV: 'parse-environment-test', PARSE_ENVIRONMENT_VALUE: 42 });
  });

  it('names every setting it rejects', () => {
    vi.stubEnv('NODE_ENV', 'parse-environment-test');
    vi.stubEnv('PARSE_ENVIRONMENT_VALUE', '0');

    expect(() => parseEnvironment(schema)).toThrow(
      new ConfigError('Config validation error: PARSE_ENVIRONMENT_VALUE: Too small: expected number to be >=1')
    );
  });
});

describe('maskSecrets', () => {
  it('masks each secret and keeps every other setting', () => {
    expect(maskSecrets({ TOKEN: 'hunter2', PORT: 3000 }, ['TOKEN'])).toEqual({ TOKEN: '[redacted]', PORT: 3000 });
  });
});
