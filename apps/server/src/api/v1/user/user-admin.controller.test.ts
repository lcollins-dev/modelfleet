import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UserListStatus,
  UserRoleId,
  CreateUserRequestDto,
  UpdateStateRequestDto,
  UpdateUserRequestDto,
  UserListRequestDto,
} from '@libs/dto';

import { User } from '@/core/user/entities/user.entity';

import { UserAdminService } from '@/api/v1/user/user-admin.service';
import { UserService } from '@/core/user/user.service';

import { UserAdminController } from '@/api/v1/user/user-admin.controller';

const buildCreateUserRequest = (): CreateUserRequestDto => ({
  name: 'Tester',
  email: 'tester@example.com',
  password: 'Sup3r$ecret',
  userRoleIds: [UserRoleId.USER_ADMIN],
});

const buildUpdateUserRequest = (overrides: Partial<UpdateUserRequestDto> = {}): UpdateUserRequestDto => ({
  name: 'Tester',
  email: 'tester@example.com',
  userRoleIds: [],
  ...overrides,
});

describe('UserAdminController', () => {
  let controller: UserAdminController;
  let createUserMock: ReturnType<typeof vi.fn>;
  let updateProfileMock: ReturnType<typeof vi.fn>;
  let updateRolesMock: ReturnType<typeof vi.fn>;
  let invalidateSessionsMock: ReturnType<typeof vi.fn>;
  let getRoleListMock: ReturnType<typeof vi.fn>;
  let getUserStatsMock: ReturnType<typeof vi.fn>;
  let getUserListMock: ReturnType<typeof vi.fn>;
  let getUserMock: ReturnType<typeof vi.fn>;
  let updateStateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    createUserMock = vi.fn();
    updateProfileMock = vi.fn().mockResolvedValue(undefined);
    updateRolesMock = vi.fn().mockResolvedValue(undefined);
    invalidateSessionsMock = vi.fn().mockResolvedValue(undefined);
    getRoleListMock = vi.fn();
    getUserStatsMock = vi.fn();
    getUserListMock = vi.fn();
    getUserMock = vi.fn();
    updateStateMock = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [UserAdminController],
      providers: [
        {
          provide: UserService,
          useValue: {
            createUser: createUserMock,
            updateProfile: updateProfileMock,
            updateRoles: updateRolesMock,
            invalidateSessions: invalidateSessionsMock,
          },
        },
        {
          provide: UserAdminService,
          useValue: {
            getRoleList: getRoleListMock,
            getUserStats: getUserStatsMock,
            getUserList: getUserListMock,
            getUser: getUserMock,
            updateState: updateStateMock,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(UserAdminController);
  });

  it('returns the role list from the service', async () => {
    getRoleListMock.mockResolvedValue([]);

    await expect(controller.getRoleList()).resolves.toEqual([]);
  });

  it('returns the user stats from the service', async () => {
    getUserStatsMock.mockResolvedValue({ total: 3, enabled: 2, disabled: 1 });

    await expect(controller.getUserStats()).resolves.toEqual({ total: 3, enabled: 2, disabled: 1 });
  });

  it('passes the filter body and the page number through to the list', async () => {
    getUserListMock.mockResolvedValue({ userList: [], pages: 0 });

    const dto: UserListRequestDto = { status: UserListStatus.ALL };

    await controller.getUserList(dto, 2);

    expect(getUserListMock).toHaveBeenCalledWith(dto, 2);
  });

  describe('createUser', () => {
    it('returns only the new user id', async () => {
      const created = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      created.id = 42;
      createUserMock.mockResolvedValue(created);

      const userId = await controller.createUser(buildCreateUserRequest());

      expect(userId).toBe(42);
    });

    it('creates the user with the requested roles and without a welcome email', async () => {
      const created = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      created.id = 42;
      createUserMock.mockResolvedValue(created);

      await controller.createUser(buildCreateUserRequest());

      expect(createUserMock).toHaveBeenCalledWith('Tester', 'tester@example.com', 'Sup3r$ecret', [
        UserRoleId.USER_ADMIN,
      ]);
    });
  });

  describe('updateUser', () => {
    it('updates the profile and then the roles for the addressed user', async () => {
      await controller.updateUser(7, buildUpdateUserRequest({ userRoleIds: [UserRoleId.SYSTEM_ADMIN] }));

      expect(updateProfileMock).toHaveBeenCalledWith('Tester', 'tester@example.com', undefined, 7);
      expect(updateRolesMock).toHaveBeenCalledWith([UserRoleId.SYSTEM_ADMIN], 7);
    });

    it('forwards a new password when one is supplied', async () => {
      await controller.updateUser(7, buildUpdateUserRequest({ password: 'Sup3r$ecret' }));

      expect(updateProfileMock).toHaveBeenCalledWith('Tester', 'tester@example.com', 'Sup3r$ecret', 7);
    });
  });

  describe('updateState', () => {
    it('unwraps the enabled flag from the body', async () => {
      const dto: UpdateStateRequestDto = { enabled: false };

      await controller.updateState(7, dto);

      expect(updateStateMock).toHaveBeenCalledWith(false, 7);
    });
  });

  describe('logoutAllSessions', () => {
    it('invalidates the addressed user session', async () => {
      await controller.logoutAllSessions(7);

      expect(invalidateSessionsMock).toHaveBeenCalledWith(7);
    });
  });

  describe('getUser', () => {
    it('passes the parsed id through', async () => {
      getUserMock.mockResolvedValue({ id: 7 });

      await controller.getUser(7);

      expect(getUserMock).toHaveBeenCalledWith(7);
    });
  });
});
