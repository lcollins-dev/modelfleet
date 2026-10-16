import { beforeEach, describe, expect, it } from 'vitest';

import { ApiKeyTokenService } from './api-key-token.service';

describe('ApiKeyTokenService', () => {
  let apiKeyTokenService: ApiKeyTokenService;

  beforeEach(() => {
    apiKeyTokenService = new ApiKeyTokenService();
  });

  describe('issue', () => {
    it('carries the identifier and a recognisable prefix in the token', () => {
      const issued = apiKeyTokenService.issue();

      expect(issued.token.startsWith('mfk_')).toBe(true);
      expect(issued.token).toContain(issued.keyId);
    });

    it('stores a hash the token cannot be recovered from', () => {
      const issued = apiKeyTokenService.issue();

      expect(issued.secretHash).toHaveLength(64);
      expect(issued.token).not.toContain(issued.secretHash);
    });

    it('issues a distinct identifier and secret each time', () => {
      const first = apiKeyTokenService.issue();
      const second = apiKeyTokenService.issue();

      expect(first.keyId).not.toBe(second.keyId);
      expect(first.secretHash).not.toBe(second.secretHash);
    });
  });

  describe('parse', () => {
    it('splits an issued token back into its identifier and secret', () => {
      const issued = apiKeyTokenService.issue();
      const parsed = apiKeyTokenService.parse(issued.token);

      expect(parsed?.keyId).toBe(issued.keyId);
      expect(apiKeyTokenService.hash(parsed?.secret ?? '')).toBe(issued.secretHash);
    });

    it('reads a secret containing the separator', () => {
      const parsed = apiKeyTokenService.parse(`mfk_${'a'.repeat(24)}_abc_def`);

      expect(parsed?.keyId).toBe('a'.repeat(24));
      expect(parsed?.secret).toBe('abc_def');
    });

    it.each([
      ['an empty string', ''],
      ['a token with no prefix', `${'a'.repeat(24)}_secret`],
      ['a foreign prefix', `sk_${'a'.repeat(24)}_secret`],
      ['a short identifier', 'mfk_abc_secret'],
      ['a non-hex identifier', `mfk_${'z'.repeat(24)}_secret`],
      ['no secret', `mfk_${'a'.repeat(24)}_`],
      ['no separator', `mfk_${'a'.repeat(24)}secret`],
    ])('refuses %s', (_description, token) => {
      expect(apiKeyTokenService.parse(token)).toBeNull();
    });
  });

  describe('matches', () => {
    it('accepts the secret the hash was taken from', () => {
      const issued = apiKeyTokenService.issue();
      const parsed = apiKeyTokenService.parse(issued.token);

      expect(apiKeyTokenService.matches(parsed?.secret ?? '', issued.secretHash)).toBe(true);
    });

    it("refuses another key's secret", () => {
      const issued = apiKeyTokenService.issue();
      const other = apiKeyTokenService.issue();

      expect(apiKeyTokenService.matches(apiKeyTokenService.parse(other.token)?.secret ?? '', issued.secretHash)).toBe(
        false
      );
    });

    it('refuses a hash of the wrong width rather than throwing', () => {
      expect(apiKeyTokenService.matches('secret', 'abcd')).toBe(false);
    });
  });
});
