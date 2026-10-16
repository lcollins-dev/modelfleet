import { describe, expect, it } from 'vitest';

import { BackendErrorType, backendError, BackendError, errorTypeForStatus } from './error';

describe('backendError', () => {
  it('builds an OpenAI-shaped error, not the management envelope', () => {
    expect(backendError(BackendErrorType.SERVER, 'No instance is ready')).toEqual({
      error: { type: 'server_error', message: 'No instance is ready', param: null, code: null },
    });
  });

  it('names the parameter and code where it has them', () => {
    const error = backendError(BackendErrorType.INVALID_REQUEST, 'Unknown model', {
      param: 'model',
      code: 'model_not_found',
    });

    expect(error.error).toMatchObject({ param: 'model', code: 'model_not_found' });
  });
});

describe('errorTypeForStatus', () => {
  it('names the type each status stands for', () => {
    expect(errorTypeForStatus(400)).toBe(BackendErrorType.INVALID_REQUEST);
    expect(errorTypeForStatus(401)).toBe(BackendErrorType.AUTHENTICATION);
    expect(errorTypeForStatus(403)).toBe(BackendErrorType.PERMISSION);
    expect(errorTypeForStatus(404)).toBe(BackendErrorType.NOT_FOUND);
    expect(errorTypeForStatus(429)).toBe(BackendErrorType.RATE_LIMIT);
  });

  it('falls back to a server error for a status it does not name', () => {
    expect(errorTypeForStatus(503)).toBe(BackendErrorType.SERVER);
    expect(errorTypeForStatus(418)).toBe(BackendErrorType.SERVER);
  });
});

describe('BackendError', () => {
  it('parses a backend error carrying a type it does not name', () => {
    const body = { error: { message: 'Slot unavailable', type: 'server_overloaded' } };

    expect(BackendError.parse(body)).toEqual(body);
  });

  it('rejects a body with no error', () => {
    expect(BackendError.safeParse({ statusCode: 500, message: 'Internal server error' }).success).toBe(false);
  });
});
