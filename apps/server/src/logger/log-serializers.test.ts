import { BadRequestException } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { stdSerializers } from 'pino-http';
import { QueryFailedError } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { serializeError, serializeReceivedRequest } from '@/logger/log-serializers';

const PASSWORD_HASH = '$2b$10$secretsecretsecretsecretsecretsecretsecretsecretsec';

const buildQueryFailedError = (): QueryFailedError => {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint "UQ_user_email"'), {
    code: '23505',
  });

  return new QueryFailedError('INSERT INTO "user" ("password") VALUES ($1)', [PASSWORD_HASH], driverError);
};

describe('serializeError', () => {
  it('keeps the type, message, stack and driver code of a failed query, and drops its parameters', () => {
    const serialized = serializeError(buildQueryFailedError());

    expect(Object.keys(serialized as object)).toEqual(['type', 'message', 'stack', 'code']);
    expect(serialized).toMatchObject({
      type: 'QueryFailedError',
      message: 'duplicate key value violates unique constraint "UQ_user_email"',
      code: '23505',
    });
    expect(JSON.stringify(serialized)).not.toContain(PASSWORD_HASH);
  });

  it('drops the response of an http exception, which can hold the request body', () => {
    const serialized = serializeError(new BadRequestException({ target: { password: PASSWORD_HASH } }));

    expect(Object.keys(serialized as object)).toEqual(['type', 'message', 'stack']);
    expect(serialized).toMatchObject({ type: 'BadRequestException', message: 'Bad Request Exception' });
  });

  it('reduces an error pino has already serialized the same way', () => {
    const serialized = serializeError(stdSerializers.err(buildQueryFailedError()));

    expect(JSON.stringify(serialized)).not.toContain(PASSWORD_HASH);
    expect(serialized).toMatchObject({ type: 'QueryFailedError', code: '23505' });
  });

  it('passes a value that is not an error through', () => {
    expect(serializeError('timed out')).toBe('timed out');
    expect(serializeError([{ property: 'email' }])).toEqual([{ property: 'email' }]);
  });
});

const buildRequest = (url: string, params: Record<string, unknown> = {}): IncomingMessage =>
  Object.assign(new IncomingMessage(new Socket()), { method: 'GET', url, originalUrl: url, params });

describe('serializeReceivedRequest', () => {
  it('drops the params the web app catch-all route fills with the path', () => {
    const logged = serializeReceivedRequest(buildRequest('/admin/users/12', { path: ['admin', 'users', '12'] }));

    expect(logged).toMatchObject({ method: 'GET', url: '/admin/users/12' });
    expect(logged).not.toHaveProperty('params');
  });

  it('keeps the headers, which the logger redacts the authorization of', () => {
    const request = buildRequest('/api/v1/user/profile');
    request.headers.authorization = 'Bearer token';
    request.headers['user-agent'] = 'vitest';

    expect(serializeReceivedRequest(request)).toHaveProperty(['headers', 'user-agent'], 'vitest');
  });
});
