import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BatchJobRunDto, BatchJobRunResult } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorType, ApiValidationError } from '@/types/api/error';

import { Config } from '@/Config';

import { useApiService } from './ApiService';

interface IAxiosRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeout: number;
  data: string;
}

interface IAxiosResponse {
  status: number;
  data: unknown;
}

const requestMock = vi.hoisted(() => vi.fn<(config: unknown) => Promise<unknown>>());

vi.mock('axios', () => ({
  default: { request: requestMock },
}));

const respondWith = (status: number, data: unknown = {}): void => {
  requestMock.mockResolvedValue({ status, data } satisfies IAxiosResponse);
};

const requestConfig = (): IAxiosRequestConfig => requestMock.mock.calls[0][0] as IAxiosRequestConfig;

const requestHeaders = (): Record<string, string> => requestConfig().headers;

describe('useApiService', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  describe('the outgoing request', () => {
    it('prefixes the endpoint with the api base url', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/profile', RequestType.GET);

      expect(requestConfig().url).toBe(`${Config.API_BASE_URL}user/profile`);
    });

    it('sends json and no authorization header when there is no token', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/login', RequestType.POST);

      const headers = requestHeaders();

      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Authorization).toBeUndefined();
    });

    it('carries the token as a bearer header', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/profile', RequestType.GET, { token: 'signed-jwt' });

      expect(requestHeaders().Authorization).toBe('Bearer signed-jwt');
    });

    it('leaves the authorization header off when the token is null', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/profile', RequestType.GET, { token: null });

      expect(requestHeaders().Authorization).toBeUndefined();
    });

    it('serialises the body as json', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/login', RequestType.POST, {
        body: { email: 'tester@example.com' },
      });

      expect(requestConfig().data).toBe(JSON.stringify({ email: 'tester@example.com' }));
    });

    it('applies the default timeout', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/profile', RequestType.GET);

      expect(requestConfig().timeout).toBe(Config.API_TIMEOUT_MS);
    });

    it('applies an overridden timeout', async () => {
      respondWith(200);

      await useApiService().makeRequest('user/profile', RequestType.GET, { timeoutMs: 500 });

      expect(requestConfig().timeout).toBe(500);
    });
  });

  describe('a successful response', () => {
    const profileSchema = z.object({ name: z.string() });

    it.each([200, 201, 202])('parses the body of a %i through the response schema', async status => {
      respondWith(status, { name: 'Tester' });

      await expect(
        useApiService().makeRequest('user/profile', RequestType.GET, { response: profileSchema })
      ).resolves.toEqual({ name: 'Tester' });
    });

    it('decodes a timestamp into a date', async () => {
      respondWith(200, {
        id: 7,
        startDate: '2026-05-15T12:00:00.000Z',
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });

      const batchJobRun = await useApiService().makeRequest('admin/batch-job/100/run', RequestType.POST, {
        response: BatchJobRunDto,
      });

      expect(batchJobRun.startDate).toEqual(new Date('2026-05-15T12:00:00.000Z'));
    });

    it('drops a field the schema does not name', async () => {
      respondWith(200, { name: 'Tester', passwordHash: 'hash' });

      await expect(
        useApiService().makeRequest('user/profile', RequestType.GET, { response: profileSchema })
      ).resolves.toEqual({ name: 'Tester' });
    });

    it('reports a body that does not match the schema as unknown', async () => {
      respondWith(200, { name: 42 });

      await expect(
        useApiService().makeRequest('user/profile', RequestType.GET, { response: profileSchema })
      ).rejects.toMatchObject({ type: ApiErrorType.UNKNOWN });
    });

    it('answers nothing when the request names no schema', async () => {
      respondWith(200, { name: 'Tester' });

      await expect(useApiService().makeRequest('user/logout', RequestType.POST)).resolves.toBeUndefined();
    });
  });

  describe('a transport failure', () => {
    it('reports an aborted request as a timeout', async () => {
      requestMock.mockRejectedValue({ code: 'ECONNABORTED' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.TIMEOUT,
      });
    });

    it('reports an unreachable host as a network error', async () => {
      requestMock.mockRejectedValue({ message: 'Network Error' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.NETWORK,
      });
    });

    it('reports anything else as unknown', async () => {
      requestMock.mockRejectedValue(new Error('boom'));

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.UNKNOWN,
      });
    });
  });

  describe('an error response', () => {
    it('maps a 401 onto an unauthorized error', async () => {
      respondWith(401, { statusCode: 401, message: 'Session expired' });

      const error = await useApiService()
        .makeRequest('user/profile', RequestType.GET)
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ type: ApiErrorType.UNAUTHORIZED, message: 'Session expired' });
    });

    it('falls back to the stock message when a 401 carries no body message', async () => {
      respondWith(401, {});

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.UNAUTHORIZED,
        message: 'Your session has ended. Sign in again to continue.',
      });
    });

    it('maps a 404 onto a not-found error', async () => {
      respondWith(404, { statusCode: 404, message: 'Nope' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.NOT_FOUND,
      });
    });

    it('maps a 429 onto a rate-limit error', async () => {
      respondWith(429, {});

      await expect(useApiService().makeRequest('user/login', RequestType.POST)).rejects.toMatchObject({
        type: ApiErrorType.TOO_MANY_REQUESTS,
      });
    });

    it('surfaces the message of a plain 400', async () => {
      respondWith(400, { statusCode: 400, message: 'Email or password is incorrect' });

      await expect(useApiService().makeRequest('user/login', RequestType.POST)).rejects.toMatchObject({
        type: ApiErrorType.UNKNOWN,
        message: 'Email or password is incorrect',
      });
    });

    it('keeps the stock message for a 5xx, whatever its body says', async () => {
      respondWith(500, { statusCode: 500, message: 'Internal server error' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.UNKNOWN,
        message: "We couldn't finish that. Try again in a moment.",
      });
    });

    it('maps a 403 onto a forbidden error with the stock message', async () => {
      respondWith(403, { statusCode: 403, message: 'Forbidden resource' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.FORBIDDEN,
        message: "You don't have access to that.",
      });
    });

    it('keeps the stock message for a 4xx with no mapping of its own', async () => {
      respondWith(409, { statusCode: 409, message: 'Conflict' });

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.UNKNOWN,
        message: "We couldn't finish that. Try again in a moment.",
      });
    });

    it('reports an unrecognised error body as unknown', async () => {
      respondWith(500, 'gateway exploded');

      await expect(useApiService().makeRequest('user/profile', RequestType.GET)).rejects.toMatchObject({
        type: ApiErrorType.UNKNOWN,
      });
    });
  });

  describe('a validation response', () => {
    const validationBody = {
      statusCode: 400,
      message: [{ path: 'email', name: 'Email address', message: 'Enter a valid email address.' }],
    };

    it('raises a validation error carrying the field messages', async () => {
      respondWith(400, validationBody);

      const error = await useApiService()
        .makeRequest('user/login', RequestType.POST)
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(ApiValidationError);
      expect((error as ApiValidationError).fields).toEqual({
        email: { name: 'Email address', message: 'Enter a valid email address.' },
      });
    });

    it('tags the error with the form that made the request', async () => {
      respondWith(400, validationBody);

      const error = await useApiService()
        .makeRequest('user/login', RequestType.POST, { form: 'sign-in' })
        .catch((error: unknown) => error);

      expect((error as ApiValidationError).form).toBe('sign-in');
    });

    it('leaves the form null when the request did not name one', async () => {
      respondWith(400, validationBody);

      const error = await useApiService()
        .makeRequest('user/login', RequestType.POST)
        .catch((error: unknown) => error);

      expect((error as ApiValidationError).form).toBeNull();
    });

    it('keys a nested refusal by its dotted path', async () => {
      respondWith(400, {
        statusCode: 400,
        message: [{ path: 'placement.gpus.deviceKey', name: 'Device key', message: 'Pins no GPU.' }],
      });

      const error = await useApiService()
        .makeRequest('admin/deployment', RequestType.POST)
        .catch((error: unknown) => error);

      expect(Object.keys((error as ApiValidationError).fields)).toEqual(['placement.gpus.deviceKey']);
    });
  });
});
