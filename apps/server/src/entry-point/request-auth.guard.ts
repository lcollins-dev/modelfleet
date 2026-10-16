import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { AuthGuard } from '@/api/v1/user/guards/auth.guard';
import { ApiKeyGuard } from '@/gateway/auth/api-key.guard';

import { EntryPoint, IEntryPointRequest } from './entry-point';

/**
 * The one global auth guard, choosing between the two entry points' credentials by the listener a
 * request arrived on. Anything not stamped as the gateway's is refused by the session guard rather
 * than let through.
 */
@Injectable()
export class RequestAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly authGuard: AuthGuard
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IEntryPointRequest>();

    return request.entryPoint === EntryPoint.GATEWAY
      ? this.apiKeyGuard.canActivate(context)
      : this.authGuard.canActivate(context);
  }
}
