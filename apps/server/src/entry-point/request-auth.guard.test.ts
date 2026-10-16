import { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestAuthGuard } from './request-auth.guard';
import { AuthGuard } from '@/api/v1/user/guards/auth.guard';
import { ApiKeyGuard } from '@/gateway/auth/api-key.guard';

import { EntryPoint } from './entry-point';

const contextFor = (entryPoint?: EntryPoint): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ entryPoint }) }) }) as unknown as ExecutionContext;

describe('RequestAuthGuard', () => {
  let apiKeyGuard: { canActivate: ReturnType<typeof vi.fn> };
  let authGuard: { canActivate: ReturnType<typeof vi.fn> };
  let requestAuthGuard: RequestAuthGuard;

  beforeEach(() => {
    apiKeyGuard = { canActivate: vi.fn().mockResolvedValue(true) };
    authGuard = { canActivate: vi.fn().mockResolvedValue(true) };

    requestAuthGuard = new RequestAuthGuard(apiKeyGuard as unknown as ApiKeyGuard, authGuard as unknown as AuthGuard);
  });

  it('checks the inference key on a request the gateway stamped', async () => {
    expect(await requestAuthGuard.canActivate(contextFor(EntryPoint.GATEWAY))).toBe(true);
    expect(apiKeyGuard.canActivate).toHaveBeenCalled();
    expect(authGuard.canActivate).not.toHaveBeenCalled();
  });

  it.each([EntryPoint.MANAGEMENT, undefined])('checks the session on a request stamped %s', async entryPoint => {
    expect(await requestAuthGuard.canActivate(contextFor(entryPoint))).toBe(true);
    expect(authGuard.canActivate).toHaveBeenCalled();
    expect(apiKeyGuard.canActivate).not.toHaveBeenCalled();
  });

  it('carries a refusal from whichever guard it chose', async () => {
    apiKeyGuard.canActivate.mockRejectedValue(new Error('refused'));

    await expect(requestAuthGuard.canActivate(contextFor(EntryPoint.GATEWAY))).rejects.toThrow('refused');
  });
});
