import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendError, BackendErrorType } from '@libs/backends/openai';

import { ApiKeyGuard } from './api-key.guard';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { ApiKeyService } from '@/core/api-key/api-key.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

const buildContext = (headers: Record<string, string | undefined>) => {
  const req = { headers };

  return {
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext,
    req,
  };
};

describe('ApiKeyGuard', () => {
  let apiKeyService: { verify: ReturnType<typeof vi.fn> };
  let apiKeyGuard: ApiKeyGuard;
  let apiKey: ApiKey;

  beforeEach(() => {
    apiKey = new ApiKey({ keyId: 'a'.repeat(24), name: 'Chat app', secretHash: 'hash', userId: 7 });
    apiKeyService = { verify: vi.fn().mockResolvedValue(apiKey) };
    apiKeyGuard = new ApiKeyGuard(apiKeyService as unknown as ApiKeyService);
  });

  it('hangs the verified key on the request', async () => {
    const { context, req } = buildContext({ authorization: 'Bearer mfk_token' });

    expect(await apiKeyGuard.canActivate(context)).toBe(true);
    expect(req).toHaveProperty('apiKey', apiKey);
    expect(apiKeyService.verify).toHaveBeenCalledWith('mfk_token');
  });

  it.each([
    ['a missing header', {}],
    ['an empty header', { authorization: '' }],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
    ['a bearer with no token', { authorization: 'Bearer ' }],
  ])('refuses %s without asking the service', async (_description, headers) => {
    const { context } = buildContext(headers);

    await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(OpenAiHttpException);
    expect(apiKeyService.verify).not.toHaveBeenCalled();
  });

  it('refuses a key the service rejects', async () => {
    apiKeyService.verify.mockResolvedValue(null);
    const { context, req } = buildContext({ authorization: 'Bearer mfk_token' });

    await expect(apiKeyGuard.canActivate(context)).rejects.toThrow(OpenAiHttpException);
    expect(req).not.toHaveProperty('apiKey');
  });

  it('answers 401 in OpenAI error form rather than the management API shape', async () => {
    apiKeyService.verify.mockResolvedValue(null);
    const { context } = buildContext({ authorization: 'Bearer mfk_token' });

    const thrown = await apiKeyGuard.canActivate(context).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(OpenAiHttpException);

    const exception = thrown as OpenAiHttpException;
    const body = exception.getResponse() as BackendError;

    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(body.error.type).toBe(BackendErrorType.AUTHENTICATION);
    expect(body.error.code).toBe('invalid_api_key');
    expect(body.error.param).toBeNull();
    expect(body).not.toHaveProperty('statusCode');
    expect(body).not.toHaveProperty('message');
  });

  it('gives one refusal whatever the cause, so keys cannot be probed', async () => {
    apiKeyService.verify.mockResolvedValue(null);

    const unknown = await apiKeyGuard
      .canActivate(buildContext({ authorization: 'Bearer mfk_unknown' }).context)
      .catch((error: unknown) => (error as OpenAiHttpException).getResponse());
    const missing = await apiKeyGuard
      .canActivate(buildContext({}).context)
      .catch((error: unknown) => (error as OpenAiHttpException).getResponse());

    expect(unknown).toEqual(missing);
  });
});
