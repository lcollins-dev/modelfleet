import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  isSupportedProtocolVersion,
  negotiateProtocolVersion,
} from './version';

describe('protocol version', () => {
  it('speaks the version it advertises', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(PROTOCOL_VERSION);
    expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
  });

  it('does not speak a version it has never heard of', () => {
    expect(isSupportedProtocolVersion(99)).toBe(false);
  });

  it('agrees on the version both sides speak', () => {
    expect(negotiateProtocolVersion([PROTOCOL_VERSION])).toBe(PROTOCOL_VERSION);
  });

  it('takes the highest version in common when an agent offers several', () => {
    expect(negotiateProtocolVersion([99, PROTOCOL_VERSION, 98])).toBe(PROTOCOL_VERSION);
  });

  it('agrees on nothing when the offer shares no version', () => {
    expect(negotiateProtocolVersion([98, 99])).toBeNull();
  });

  it('agrees on nothing when an agent offers no version at all', () => {
    expect(negotiateProtocolVersion([])).toBeNull();
  });
});
