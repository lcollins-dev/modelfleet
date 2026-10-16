import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EventPartyType,
  EventSeverity,
  EventType,
  UserRoleId,
  LoginRequestDto,
  UpdateProfileRequestDto,
} from '@libs/dto';

import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { EventService } from '@/core/event/event.service';
import { UserService } from '@/core/user/user.service';

import { UserController } from '@/api/v1/user/user.controller';

describe('UserController', () => {
  let controller: UserController;
  let recordEventMock: ReturnType<typeof vi.fn>;
  let checkLoginWithThrowMock: ReturnType<typeof vi.fn>;
  let createLoginTokenMock: ReturnType<typeof vi.fn>;
  let updateProfileMock: ReturnType<typeof vi.fn>;
  let startSessionMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    recordEventMock = vi.fn().mockResolvedValue(undefined);
    checkLoginWithThrowMock = vi.fn();
    createLoginTokenMock = vi.fn();
    updateProfileMock = vi.fn().mockResolvedValue(undefined);
    startSessionMock = vi.fn();

    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: EventService,
          useValue: { recordEvent: recordEventMock },
        },
        {
          provide: UserService,
          useValue: {
            checkLoginWithThrow: checkLoginWithThrowMock,
            createLoginToken: createLoginTokenMock,
            updateProfile: updateProfileMock,
            startSession: startSessionMock,
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(UserController);
  });

  describe('login', () => {
    const buildLoginRequest = (): LoginRequestDto => ({ email: 'tester@example.com', password: 'Sup3r$ecret' });

    const buildUser = (): User => {
      const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      user.id = 7;

      return user;
    };

    it('records the sign-in against the user who made it', async () => {
      checkLoginWithThrowMock.mockResolvedValue(buildUser());
      createLoginTokenMock.mockResolvedValue('signed-jwt');

      const response = await controller.login(buildLoginRequest());

      expect(recordEventMock).toHaveBeenCalledWith(EventType.USER_SIGNED_IN, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: '7',
        subjectType: EventPartyType.USER,
        subjectId: '7',
        message: '**Tester** signed in as `tester@example.com`',
        detail: { email: 'tester@example.com' },
      });
      expect(response).toEqual({ token: 'signed-jwt' });
    });

    it('records a failed sign-in and lets the failure through', async () => {
      checkLoginWithThrowMock.mockRejectedValue(new BadRequestException('nope'));

      await expect(controller.login(buildLoginRequest())).rejects.toThrow(BadRequestException);

      expect(recordEventMock).toHaveBeenCalledWith(EventType.USER_SIGN_IN_FAILED, EventSeverity.WARNING, {
        subjectType: EventPartyType.USER,
        message: 'Sign-in refused for `tester@example.com`',
        detail: { email: 'tester@example.com' },
      });
    });

    it('issues no token when the credentials are refused', async () => {
      checkLoginWithThrowMock.mockRejectedValue(new BadRequestException('nope'));

      await expect(controller.login(buildLoginRequest())).rejects.toThrow(BadRequestException);

      expect(createLoginTokenMock).not.toHaveBeenCalled();
    });
  });

  describe('updateProfile', () => {
    const buildUpdateProfileRequest = (password?: string): UpdateProfileRequestDto => ({
      name: 'Tester',
      email: 'tester@example.com',
      password,
    });

    const buildUser = (): User => {
      const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      user.id = 7;

      return user;
    };

    it('hands back a replacement token when the password changed', async () => {
      startSessionMock.mockResolvedValue('new-jwt');

      const response = await controller.updateProfile(buildUser(), buildUpdateProfileRequest('Sup3r$ecret'));

      expect(updateProfileMock).toHaveBeenCalledWith('Tester', 'tester@example.com', 'Sup3r$ecret', 7);
      expect(response).toEqual({ token: 'new-jwt' });
    });

    it('starts no new session when the password was left alone', async () => {
      const response = await controller.updateProfile(buildUser(), buildUpdateProfileRequest());

      expect(startSessionMock).not.toHaveBeenCalled();
      expect(response).toEqual({});
    });
  });

  describe('getProfile', () => {
    it('maps user role ids from userRoleId (not the junction-table id)', () => {
      const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      user.id = 1;

      const adminRole = new UserUserRole(1, UserRoleId.USER_ADMIN);
      adminRole.id = 501;
      const systemRole = new UserUserRole(1, UserRoleId.SYSTEM_ADMIN);
      systemRole.id = 502;

      user.userUserRoles = [adminRole, systemRole];

      const profile = controller.getProfile(user);

      expect(profile).toEqual({
        name: 'Tester',
        email: 'tester@example.com',
        userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
        mustChangePassword: false,
      });
    });

    it('reports the setup hold, so the web app can keep the user on their profile', () => {
      const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      user.id = 1;
      user.mustChangePassword = true;

      expect(controller.getProfile(user).mustChangePassword).toBe(true);
    });

    it('returns an empty role list when the user has no roles', () => {
      const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hash' });
      user.id = 1;
      user.userUserRoles = [];

      const profile = controller.getProfile(user);

      expect(profile.userRoleIds).toEqual([]);
    });
  });
});
