import { beforeEach, describe, expect, it } from 'vitest';

import { RelayTokenService } from '@/relay/relay-token.service';

describe('RelayTokenService', () => {
  let relayTokenService: RelayTokenService;

  beforeEach(() => {
    relayTokenService = new RelayTokenService();
  });

  it('accepts nothing until a handshake has minted a token', () => {
    expect(relayTokenService.accepts('')).toBe(false);
    expect(relayTokenService.accepts('anything')).toBe(false);
  });

  it('accepts the token it minted and refuses every other', () => {
    const token = relayTokenService.mint();

    expect(relayTokenService.accepts(token)).toBe(true);
    expect(relayTokenService.accepts(`${token}x`)).toBe(false);
    expect(relayTokenService.accepts(token.slice(0, -1))).toBe(false);
  });

  it('mints a token long enough that the protocol carries it', () => {
    expect(relayTokenService.mint().length).toBeGreaterThanOrEqual(32);
  });

  it('mints a different token each time, so a token outlives only its own connection', () => {
    const first = relayTokenService.mint();
    const second = relayTokenService.mint();

    expect(second).not.toBe(first);
    expect(relayTokenService.accepts(first)).toBe(false);
    expect(relayTokenService.accepts(second)).toBe(true);
  });

  it('refuses the last token once the session that minted it is gone', () => {
    const token = relayTokenService.mint();

    relayTokenService.clear();

    expect(relayTokenService.accepts(token)).toBe(false);
  });
});
