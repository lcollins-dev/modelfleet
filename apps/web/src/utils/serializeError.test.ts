import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';

import { serializeError } from './serializeError';

const TOKEN = 'Bearer secret-session-token';

const makeAxiosError = (): AxiosError => {
  const config = { url: '/api/v1/user/profile', method: 'get', headers: new AxiosHeaders({ Authorization: TOKEN }) };

  return new AxiosError('Network Error', 'ERR_NETWORK', config, { headers: { Authorization: TOKEN } });
};

describe('serializeError', () => {
  it('keeps the code and message of an axios error', () => {
    expect(serializeError(makeAxiosError())).toMatchObject({ code: 'ERR_NETWORK', message: 'Network Error' });
  });

  it('drops the request config, request and response, and with them the session token', () => {
    const serialized = serializeError(makeAxiosError());

    expect(serialized).not.toHaveProperty('config');
    expect(serialized).not.toHaveProperty('request');
    expect(serialized).not.toHaveProperty('response');
    expect(JSON.stringify(serialized)).not.toContain('secret-session-token');
  });

  it('drops the routes of a navigation failure, whose path can hold a token', () => {
    const failure = Object.assign(new Error('Navigation aborted'), {
      to: { fullPath: '/dashboard' },
      from: { fullPath: '/sign-in?redirect=/reset-password/secret-token' },
    });

    const serialized = serializeError(failure);

    expect(serialized).toMatchObject({ message: 'Navigation aborted' });
    expect(JSON.stringify(serialized)).not.toContain('secret-token');
  });

  it('leaves no reference to the original error', () => {
    const serialized = serializeError(makeAxiosError());

    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
    expect(Object.getOwnPropertySymbols(serialized)).toEqual([]);
  });

  it('passes a value that is not an error through', () => {
    expect(serializeError('plain')).toBe('plain');
  });
});
