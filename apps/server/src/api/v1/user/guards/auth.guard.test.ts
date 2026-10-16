import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { ALLOWED_ROLES_METADATA_KEY } from '@/api/v1/user/decorators/allowed-roles.decorator';
import { NO_AUTH_METADATA_KEY } from '@/api/v1/user/decorators/no-auth.decorator';
import { ALLOWED_DURING_SETUP_METADATA_KEY, AuthGuard, SETUP_REQUIRED_MESSAGE } from '@/api/v1/user/guards/auth.guard';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { NOT_ALLOWED_MESSAGE, SESSION_EXPIRED_MESSAGE, UserService } from '@/core/user/user.service';

interface IMockRequest {
  headers: Record<string, string | undefined>;
  user?: User;
}

const buildUserWithRoles = (roleIds: UserRoleId[]): User => {
  const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });

  user.userUserRoles = roleIds.map((roleId, index) => {
    const userUserRole = new UserUserRole(1, roleId);
    userUserRole.id = index + 1;
    return userUserRole;
  });

  return user;
};

const buildContext = (request: IMockRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: vi.fn(),
      getNext: vi.fn(),
    }),
    getClass: () => class TestController {},
    getHandler: () => () => undefined,
    getArgs: vi.fn(),
    getArgByIndex: vi.fn(),
    switchToRpc: vi.fn(),
    switchToWs: vi.fn(),
    getType: vi.fn(),
  }) as unknown as ExecutionContext;

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let reflectorGet: ReturnType<typeof vi.fn>;
  let checkTokenMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    reflectorGet = vi.fn();
    checkTokenMock = vi.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthGuard,
        {
          provide: Reflector,
          useValue: { get: reflectorGet },
        },
        {
          provide: UserService,
          useValue: { checkToken: checkTokenMock },
        },
      ],
    }).compile();

    guard = moduleRef.get(AuthGuard);
  });

  describe('no-auth bypass', () => {
    it('returns true when no-auth is set on the controller', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === NO_AUTH_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return true;
        }

        return undefined;
      });

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(checkTokenMock).not.toHaveBeenCalled();
    });

    it('returns true when no-auth is set on the route handler', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === NO_AUTH_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return true;
        }

        return undefined;
      });

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(checkTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('missing auth header', () => {
    it('throws when no authorization header is present', async () => {
      reflectorGet.mockReturnValue(undefined);

      const context = buildContext({ headers: {} });

      await expect(guard.canActivate(context)).rejects.toThrow(new UnauthorizedException(SESSION_EXPIRED_MESSAGE));
    });
  });

  describe('role checking', () => {
    it('returns true when the user holds a controller-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return [UserRoleId.USER_ADMIN];
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildUserWithRoles([UserRoleId.USER_ADMIN]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(checkTokenMock).toHaveBeenCalledWith('abc');
    });

    it('refuses with a 403 when the user does not hold any controller-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return [UserRoleId.SYSTEM_ADMIN];
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildUserWithRoles([UserRoleId.USER_ADMIN]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      const refusal = guard.canActivate(context);

      await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refusal).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    });

    it('returns true when the user holds a route-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return [UserRoleId.USER_ADMIN];
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildUserWithRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('refuses with a 403 when the user does not hold any route-required role', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_ROLES_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return [UserRoleId.SYSTEM_ADMIN];
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildUserWithRoles([UserRoleId.USER_ADMIN]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      const refusal = guard.canActivate(context);

      await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refusal).rejects.toThrow(NOT_ALLOWED_MESSAGE);
    });

    it('returns true when no role requirements are set', async () => {
      reflectorGet.mockReturnValue(undefined);
      checkTokenMock.mockResolvedValue(buildUserWithRoles([]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('setup hold', () => {
    const buildHeldUser = (roleIds: UserRoleId[]): User => {
      const user = buildUserWithRoles(roleIds);
      user.mustChangePassword = true;

      return user;
    };

    it('refuses a held user with a 403 on a handler not allowed during setup, roles notwithstanding', async () => {
      reflectorGet.mockReturnValue(undefined);
      checkTokenMock.mockResolvedValue(buildHeldUser([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      const refusal = guard.canActivate(context);

      await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refusal).rejects.toThrow(SETUP_REQUIRED_MESSAGE);
    });

    it('lets a held user call a handler allowed during setup', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_DURING_SETUP_METADATA_KEY && typeof target === 'function' && !('prototype' in target)) {
          return true;
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildHeldUser([]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('ignores the allowance on a controller, so it never opens every route at once', async () => {
      reflectorGet.mockImplementation((key: string, target: unknown) => {
        if (key === ALLOWED_DURING_SETUP_METADATA_KEY && typeof target === 'function' && target.prototype) {
          return true;
        }

        return undefined;
      });
      checkTokenMock.mockResolvedValue(buildHeldUser([]));

      const context = buildContext({ headers: { authorization: 'Bearer abc' } });

      await expect(guard.canActivate(context)).rejects.toThrow(SETUP_REQUIRED_MESSAGE);
    });
  });

  describe('Bearer token extraction', () => {
    it('strips the "Bearer " prefix before passing the token to UserService', async () => {
      reflectorGet.mockReturnValue(undefined);
      checkTokenMock.mockResolvedValue(buildUserWithRoles([]));

      const context = buildContext({ headers: { authorization: 'Bearer my-token-value' } });

      await guard.canActivate(context);

      expect(checkTokenMock).toHaveBeenCalledWith('my-token-value');
    });

    it('attaches the resolved user to the request', async () => {
      reflectorGet.mockReturnValue(undefined);

      const resolvedUser = buildUserWithRoles([UserRoleId.USER_ADMIN]);
      checkTokenMock.mockResolvedValue(resolvedUser);

      const request: IMockRequest = { headers: { authorization: 'Bearer abc' } };
      const context = buildContext(request);

      await guard.canActivate(context);

      expect(request.user).toBe(resolvedUser);
    });
  });
});
