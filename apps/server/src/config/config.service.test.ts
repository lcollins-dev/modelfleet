import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigError } from '@libs/runtime';

import { ConfigService } from './config.service';

const TOKEN = 'hf_fleetToken123';

describe('ConfigService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('trustProxy', () => {
    const trustProxy = (setting: string | undefined): boolean | number | string => {
      vi.stubEnv('TRUST_PROXY', setting);

      return new ConfigService().trustProxy;
    };

    it('reads an all-digit setting as a hop count', () => {
      expect(trustProxy('2')).toBe(2);
    });

    it('trims the setting before reading it', () => {
      expect(trustProxy(' 1 ')).toBe(1);
    });

    it('reads true and false as booleans, which Express would otherwise take for addresses', () => {
      expect(trustProxy('true')).toBe(true);
      expect(trustProxy('false')).toBe(false);
    });

    it('passes a list of addresses and named ranges on as a string', () => {
      expect(trustProxy('loopback, 192.0.2.0/24')).toBe('loopback, 192.0.2.0/24');
    });

    it.each([undefined, ''])('trusts no proxy when %j', setting => {
      expect(trustProxy(setting)).toBe(false);
    });
  });

  describe('emailSmtpSecure', () => {
    it('defaults to false, to pair with STARTTLS on the default port 587', () => {
      vi.stubEnv('EMAIL_SMTP_SECURE', undefined);

      expect(new ConfigService().emailSmtpSecure).toBe(false);
      expect(new ConfigService().emailSmtpPort).toBe(587);
    });
  });

  describe('userIdleTimeoutMs', () => {
    it('accepts 0 and a span with a unit', () => {
      for (const [setting, milliseconds] of [
        ['0', 0],
        ['30m', 1_800_000],
        ['12 hours', 43_200_000],
      ] as const) {
        vi.stubEnv('USER_IDLE_TIMEOUT', setting);

        expect(new ConfigService().userIdleTimeoutMs).toBe(milliseconds);
      }
    });

    it('refuses a number without a unit, which ms would read as milliseconds', () => {
      vi.stubEnv('USER_IDLE_TIMEOUT', '30');

      expect(() => new ConfigService()).toThrow(/USER_IDLE_TIMEOUT: must be a duration with a unit/);
    });
  });

  describe('secrets', () => {
    it('refuses a short user token secret, naming the setting and the minimum', () => {
      vi.stubEnv('USER_TOKEN_SECRET', 'a'.repeat(31));

      expect(() => new ConfigService()).toThrow(/USER_TOKEN_SECRET: must be at least 32 characters/);
    });

    it('leaves the refused value out of the error', () => {
      vi.stubEnv('USER_TOKEN_SECRET', 'leaked-secret');

      expect(() => new ConfigService()).toThrow(/USER_TOKEN_SECRET/);
      expect(() => new ConfigService()).not.toThrow(/leaked-secret/);
    });

    it('refuses a blank database password rather than falling back to a published one', () => {
      vi.stubEnv('TYPEORM_PASSWORD', '');

      expect(() => new ConfigService()).toThrow(/TYPEORM_PASSWORD:/);
    });
  });

  describe('instance output', () => {
    it('asks for the last 1000 lines by default', () => {
      vi.stubEnv('INSTANCE_OUTPUT_TAIL_LINES', undefined);

      expect(new ConfigService().instanceOutputTailLines).toBe(1000);
    });

    it('refuses a tail the agent would refuse', () => {
      vi.stubEnv('INSTANCE_OUTPUT_TAIL_LINES', '10001');

      expect(() => new ConfigService()).toThrow(/INSTANCE_OUTPUT_TAIL_LINES/);
    });

    it('refuses a tail of no lines, which would open on nothing', () => {
      vi.stubEnv('INSTANCE_OUTPUT_TAIL_LINES', '0');

      expect(() => new ConfigService()).toThrow(/INSTANCE_OUTPUT_TAIL_LINES/);
    });
  });

  describe('batch jobs', () => {
    it('keeps 100 failed runs per job and runs residency every thirty seconds by default', () => {
      vi.stubEnv('BATCH_JOB_RUN_HISTORY_SIZE', undefined);
      vi.stubEnv('BATCH_JOB_RESIDENCY_CRON', undefined);

      const configService = new ConfigService();

      expect(configService.batchJobRunHistorySize).toBe(100);
      expect(configService.batchJobResidencyCron).toBe('*/30 * * * * *');
    });

    it('refuses a history size below one', () => {
      vi.stubEnv('BATCH_JOB_RUN_HISTORY_SIZE', '0');

      expect(() => new ConfigService()).toThrow(/BATCH_JOB_RUN_HISTORY_SIZE/);
    });

    it('refuses a schedule that is not a cron expression', () => {
      vi.stubEnv('BATCH_JOB_RESIDENCY_CRON', 'every thirty seconds');

      expect(() => new ConfigService()).toThrow(/BATCH_JOB_RESIDENCY_CRON: must be a cron expression/);
    });
  });

  describe('huggingfaceToken', () => {
    it('reads the token', () => {
      vi.stubEnv('HUGGINGFACE_TOKEN', TOKEN);

      expect(new ConfigService().huggingfaceToken).toBe(TOKEN);
    });

    it.each([undefined, '', '   '])('reads %j as no token', value => {
      vi.stubEnv('HUGGINGFACE_TOKEN', value);

      expect(new ConfigService().huggingfaceToken).toBeNull();
    });

    it.each(['hf_abc def', 'hf_abc\ndef', 'abc123'])(
      'refuses %j at startup, without quoting it in the error',
      value => {
        vi.stubEnv('HUGGINGFACE_TOKEN', value);

        expect(() => new ConfigService()).toThrow(ConfigError);
        expect(() => new ConfigService()).not.toThrow(value);
      }
    );

    it('masks the token in the settings it logs', () => {
      vi.stubEnv('HUGGINGFACE_TOKEN', TOKEN);

      expect(new ConfigService().loggable.HUGGINGFACE_TOKEN).toBe('[redacted]');
    });
  });
});
