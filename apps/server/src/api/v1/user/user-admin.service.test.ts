import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserListStatus, UserRoleId } from '@libs/dto';

import { UserRole } from '@/core/user/entities/user-role.entity';
import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { UserAdminService } from '@/api/v1/user/user-admin.service';
import { ConfigService } from '@/config/config.service';
import { UserService } from '@/core/user/user.service';

const PAGE_SIZE = 10;

const buildUser = (overrides: Partial<User> = {}): User => {
  const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });

  user.id = 1;
  user.enabled = true;
  user.lastAccess = new Date('2026-05-01T09:00:00Z');
  user.createdDate = new Date('2026-04-01T09:00:00Z');

  Object.assign(user, overrides);

  return user;
};

describe('UserAdminService', () => {
  let userAdminService: UserAdminService;
  let userService: {
    findRoles: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
    countByState: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    userService = {
      findRoles: vi.fn().mockResolvedValue([]),
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      countByState: vi.fn().mockResolvedValue({ total: 0, enabled: 0 }),
      findWithThrow: vi.fn().mockResolvedValue(buildUser()),
      setEnabled: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    userAdminService = moduleRef.get(UserAdminService);
  });

  describe('getRoleList', () => {
    it('reads each role down to its id and name', async () => {
      userService.findRoles.mockResolvedValue([new UserRole(UserRoleId.SYSTEM_ADMIN, 'System admin')]);

      const roles = await userAdminService.getRoleList();

      expect(roles).toEqual([{ id: UserRoleId.SYSTEM_ADMIN, name: 'System admin' }]);
    });
  });

  describe('getUserList', () => {
    it('turns the requested page into an offset and a limit', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ALL }, 3);

      expect(userService.findAndCount).toHaveBeenCalledWith(
        { search: undefined, enabled: undefined },
        PAGE_SIZE * 2,
        PAGE_SIZE
      );
    });

    it('passes the search term through as criteria', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ALL, search: 'tester' }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith({ search: 'tester', enabled: undefined }, 0, PAGE_SIZE);
    });

    it('narrows to enabled users alone', async () => {
      await userAdminService.getUserList({ status: UserListStatus.ENABLED }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith({ search: undefined, enabled: true }, 0, PAGE_SIZE);
    });

    it('narrows to disabled users alone', async () => {
      await userAdminService.getUserList({ status: UserListStatus.DISABLED }, 1);

      expect(userService.findAndCount).toHaveBeenCalledWith({ search: undefined, enabled: false }, 0, PAGE_SIZE);
    });

    it('reads each row down to what a list needs', async () => {
      const user = buildUser();
      user.userUserRoles = [new UserUserRole(user.id, UserRoleId.SYSTEM_ADMIN)];
      userService.findAndCount.mockResolvedValue([[user], 1]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(response.userList).toEqual([
        {
          id: 1,
          name: 'Tester',
          email: 'tester@example.com',
          enabled: true,
          userRoleIds: [UserRoleId.SYSTEM_ADMIN],
        },
      ]);
    });

    it('keeps the password hash out of the list', async () => {
      userService.findAndCount.mockResolvedValue([[buildUser()], 1]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(JSON.stringify(response)).not.toContain('hash');
    });

    it('rounds the page count up on a partial last page', async () => {
      userService.findAndCount.mockResolvedValue([[], 21]);

      const response = await userAdminService.getUserList({ status: UserListStatus.ALL }, 1);

      expect(response.pages).toBe(3);
    });
  });

  describe('getUserStats', () => {
    it('reports the disabled count as the remainder', async () => {
      userService.countByState.mockResolvedValue({ total: 10, enabled: 7 });

      const stats = await userAdminService.getUserStats();

      expect(stats).toEqual({ total: 10, enabled: 7, disabled: 3 });
    });
  });

  describe('getUser', () => {
    it('asks for the roles alongside the row', async () => {
      await userAdminService.getUser(1);

      expect(userService.findWithThrow).toHaveBeenCalledWith(1, true);
    });

    it('throws when the user does not exist', async () => {
      userService.findWithThrow.mockRejectedValue(new BadRequestException());

      await expect(userAdminService.getUser(1)).rejects.toThrow(BadRequestException);
    });

    it('answers with the dates as they stand, for JSON to encode', async () => {
      const user = await userAdminService.getUser(1);

      expect(user.lastAccess).toEqual(new Date('2026-05-01T09:00:00Z'));
      expect(user.createdDate).toEqual(new Date('2026-04-01T09:00:00Z'));
    });

    it('reports a user who has never signed in as never having done so', async () => {
      const user = await userAdminService.getUser(1);

      expect(user.lastLoginSuccess).toBeNull();
      expect(user.lastLoginFail).toBeNull();
    });

    it('keeps the password hash out of the response', async () => {
      const user = await userAdminService.getUser(1);

      expect(JSON.stringify(user)).not.toContain('hash');
    });
  });

  describe('updateState', () => {
    it('changes state through the domain', async () => {
      await userAdminService.updateState(false, 1);

      expect(userService.setEnabled).toHaveBeenCalledWith(1, false);
    });
  });
});
