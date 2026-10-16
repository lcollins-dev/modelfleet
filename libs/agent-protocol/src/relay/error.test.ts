import { describe, expect, it } from 'vitest';

import { RelayError, relayError, RelayErrorCode } from './error';

describe('RelayError', () => {
  it('reads the refusal relayError builds', () => {
    const refusal = relayError(RelayErrorCode.INSTANCE_NOT_READY, 'Not ready');

    expect(RelayError.parse(refusal)).toEqual(refusal);
  });

  it('refuses a code the relay never answers with', () => {
    expect(RelayError.safeParse({ error: { code: 'model_not_found', message: 'No such model' } }).success).toBe(false);
  });
});
