import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { intersection } from 'lodash';

import { UserRoleId } from '@libs/dto';

import { ALLOWED_ROLES_METADATA_KEY } from '../decorators/allowed-roles.decorator';
import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';

import { User } from '@/core/user/entities/user.entity';

import { NOT_ALLOWED_MESSAGE, SESSION_EXPIRED_MESSAGE, UserService } from '@/core/user/user.service';

export const SETUP_REQUIRED_MESSAGE = 'Set a new password before doing anything else';

/** Set on a handler, never a controller, to let an account held to a password change call it. */
export const ALLOWED_DURING_SETUP_METADATA_KEY = 'allowed-during-setup';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(UserService) private readonly userService: UserService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const noAuthController = this.reflector.get<boolean | undefined>(NO_AUTH_METADATA_KEY, context.getClass());
    const noAuthRoute = this.reflector.get<boolean | undefined>(NO_AUTH_METADATA_KEY, context.getHandler());

    const requiresRoleController = this.reflector.get<UserRoleId[] | undefined>(
      ALLOWED_ROLES_METADATA_KEY,
      context.getClass()
    );
    const requiresRoleRoute = this.reflector.get<UserRoleId[] | undefined>(
      ALLOWED_ROLES_METADATA_KEY,
      context.getHandler()
    );

    if (noAuthController || noAuthRoute) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const authHeader =
      'authorization' in req.headers && typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : undefined;

    if (!authHeader) {
      throw new UnauthorizedException(SESSION_EXPIRED_MESSAGE);
    }

    const user = await this.userService.checkToken(authHeader.replace('Bearer ', ''));
    req.user = user;

    if (user.mustChangePassword && !this.allowedDuringSetup(context)) {
      throw new ForbiddenException(SETUP_REQUIRED_MESSAGE);
    }

    // Check our controller roles - if set
    if (
      requiresRoleController &&
      intersection(
        requiresRoleController,
        (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId)
      ).length === 0
    ) {
      throw new ForbiddenException(NOT_ALLOWED_MESSAGE);
    }

    // Check our route roles - if set
    if (
      requiresRoleRoute &&
      intersection(
        requiresRoleRoute,
        (user.userUserRoles ?? []).map(userUserRole => userUserRole.userRoleId)
      ).length === 0
    ) {
      throw new ForbiddenException(NOT_ALLOWED_MESSAGE);
    }

    return true;
  }

  private allowedDuringSetup(context: ExecutionContext): boolean {
    return this.reflector.get<boolean | undefined>(ALLOWED_DURING_SETUP_METADATA_KEY, context.getHandler()) === true;
  }
}
