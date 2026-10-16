import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { UserRole } from '@/core/user/entities/user-role.entity';
import { UserUserRole } from '@/core/user/entities/user-user-role.entity';
import { User } from '@/core/user/entities/user.entity';

import { ConfigService } from '@/config/config.service';
import { TokenService } from '@/core/user/token.service';
import {
  ACCOUNT_DISABLED_MESSAGE,
  INITIAL_PASSWORD_REUSED_MESSAGE,
  INVALID_LOGIN_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  UserService,
} from '@/core/user/user.service';
import { EmailService, EmailTemplate } from '@/email/email.service';

import { issuesFrom } from '@/test/validation';

const INVALID_LOGIN_ISSUE = { path: 'password', name: 'Password', message: INVALID_LOGIN_MESSAGE };

vi.mock('bcryptjs', () => ({
  hash: vi.fn(),
  compare: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(),
}));

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

type BcryptHash = (password: string, rounds: number) => Promise<string>;
type BcryptCompare = (password: string, hash: string) => Promise<boolean>;
type UuidV4 = () => string;

interface IRepositoryMock {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

const makeRepoMock = (): IRepositoryMock => ({
  findOne: vi.fn(),
  find: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  save: vi.fn(),
});

const buildUser = (overrides: Partial<User> = {}): User => {
  const user = new User({ name: 'Tester', email: 'tester@example.com', passwordHash: 'hashed-password' });

  user.id = 1;
  user.enabled = true;
  user.sessionUuid = 'session-uuid';
  user.lastLoginSuccess = null;
  user.lastLoginFail = null;
  user.lastAccess = new Date();
  user.createdDate = new Date();
  user.userUserRoles = [];

  Object.assign(user, overrides);

  return user;
};

describe('UserService', () => {
  let userService: UserService;
  let userRepository: IRepositoryMock;
  let userRoleRepository: IRepositoryMock;
  let userUserRoleRepository: IRepositoryMock;
  let createTokenMock: ReturnType<typeof vi.fn>;
  let decodeTokenMock: ReturnType<typeof vi.fn>;
  let sendEmailMock: ReturnType<typeof vi.fn>;
  let configMock: { userPasswordHashRounds: number; userIdleTimeoutMs: number; webAppBaseUrl: string };

  beforeEach(async () => {
    userRepository = makeRepoMock();
    userRoleRepository = makeRepoMock();
    userUserRoleRepository = makeRepoMock();
    createTokenMock = vi.fn();
    decodeTokenMock = vi.fn();
    sendEmailMock = vi.fn().mockResolvedValue(true);

    configMock = {
      userPasswordHashRounds: 4,
      userIdleTimeoutMs: 900_000,
      webAppBaseUrl: 'https://app.test',
    };

    vi.mocked(bcrypt.hash as BcryptHash).mockImplementation(password => Promise.resolve(`hashed:${password}`));
    vi.mocked(bcrypt.compare as BcryptCompare).mockImplementation((password, hash) =>
      Promise.resolve(hash === `hashed:${password}`)
    );
    vi.mocked(uuidv4 as UuidV4).mockReturnValue('fixed-session-uuid');

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: ConfigService, useValue: configMock },
        { provide: EmailService, useValue: { sendEmail: sendEmailMock } },
        { provide: TokenService, useValue: { createToken: createTokenMock, decodeToken: decodeTokenMock } },
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepository },
        { provide: getRepositoryToken(UserUserRole), useValue: userUserRoleRepository },
      ],
    }).compile();

    userService = moduleRef.get(UserService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createUser', () => {
    it('normalizes the email before checking for duplicates', async () => {
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(buildUser());
      userRepository.insert.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([]);
      userUserRoleRepository.delete.mockResolvedValue(undefined);

      await userService.createUser('Tester', '  TESTER@Example.com  ', 'pw', []);

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email: 'tester@example.com' } });
    });

    it('rejects when a user with the same email already exists', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());

      await expect(userService.createUser('Tester', 'tester@example.com', 'pw', [])).rejects.toThrow(
        BadRequestException
      );

      expect(userRepository.insert).not.toHaveBeenCalled();
    });

    it('hashes the password using the configured rounds and stores the user', async () => {
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(buildUser());
      userRepository.insert.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([]);
      userUserRoleRepository.delete.mockResolvedValue(undefined);

      await userService.createUser('Tester', 'tester@example.com', 'plain-password', []);

      expect(bcrypt.hash).toHaveBeenCalledWith('plain-password', 4);
      expect(userRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'tester@example.com', passwordHash: 'hashed:plain-password' })
      );
    });

    it('sends a welcome email when the flag is set', async () => {
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(buildUser());
      userRepository.insert.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([]);
      userUserRoleRepository.delete.mockResolvedValue(undefined);

      await userService.createUser('Tester', 'tester@example.com', 'pw', [], true);

      expect(sendEmailMock).toHaveBeenCalledWith('tester@example.com', EmailTemplate.WELCOME, {
        name: 'Tester',
        signInUrl: 'https://app.test/sign-in',
      });
    });

    it('does not send a welcome email by default', async () => {
      userRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(buildUser());
      userRepository.insert.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([]);
      userUserRoleRepository.delete.mockResolvedValue(undefined);

      await userService.createUser('Tester', 'tester@example.com', 'pw', []);

      expect(sendEmailMock).not.toHaveBeenCalled();
    });
  });

  describe('checkLoginWithThrow', () => {
    it('normalizes the email when looking up the user', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.checkLoginWithThrow('  TESTER@Example.com  ', 'pw')).rejects.toThrow(
        BadRequestException
      );

      expect(userRepository.findOne).toHaveBeenCalledWith({ where: { email: 'tester@example.com' } });
    });

    it('refuses an unknown email on the password field', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(issuesFrom(() => userService.checkLoginWithThrow('tester@example.com', 'pw'))).resolves.toEqual([
        INVALID_LOGIN_ISSUE,
      ]);
    });

    it('records a failed login and refuses a wrong password exactly as an unknown email', async () => {
      const user = buildUser({ passwordHash: 'hashed:correct-password' });
      userRepository.findOne.mockResolvedValue(user);

      await expect(
        issuesFrom(() => userService.checkLoginWithThrow('tester@example.com', 'wrong-password'))
      ).resolves.toEqual([INVALID_LOGIN_ISSUE]);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ lastLoginFail: expect.any(Date) as Date }) as Partial<User>
      );
    });

    it('returns the user when the password is correct', async () => {
      const user = buildUser({ passwordHash: 'hashed:correct-password' });
      userRepository.findOne.mockResolvedValue(user);

      const result = await userService.checkLoginWithThrow('tester@example.com', 'correct-password');

      expect(result).toBe(user);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a disabled account holding the right password', async () => {
      const user = buildUser({ passwordHash: 'hashed:correct-password', enabled: false });
      userRepository.findOne.mockResolvedValue(user);

      await expect(userService.checkLoginWithThrow('tester@example.com', 'correct-password')).rejects.toThrow(
        new BadRequestException(ACCOUNT_DISABLED_MESSAGE)
      );
    });

    it('reports a wrong password on a disabled account as a bad login', async () => {
      const user = buildUser({ passwordHash: 'hashed:correct-password', enabled: false });
      userRepository.findOne.mockResolvedValue(user);

      await expect(userService.checkLoginWithThrow('tester@example.com', 'wrong-password')).rejects.toThrow(
        BadRequestException
      );

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ lastLoginFail: expect.any(Date) as Date }) as Partial<User>
      );
    });
  });

  describe('updateProfile', () => {
    beforeEach(() => {
      userRepository.save.mockResolvedValue(undefined);
    });

    it('drops the session when the password changes', async () => {
      const user = buildUser();
      userRepository.findOne.mockResolvedValue(user);

      await userService.updateProfile('Tester', 'tester@example.com', 'new-password', 1);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ sessionUuid: null, passwordHash: 'hashed:new-password' })
      );
    });

    it('clears the setup hold when the password changes', async () => {
      userRepository.findOne.mockResolvedValue(buildUser({ mustChangePassword: true }));

      await userService.updateProfile('Tester', 'tester@example.com', 'new-password', 1);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ mustChangePassword: false, passwordHash: 'hashed:new-password' })
      );
    });

    it('refuses the initial password as the new one while the setup hold is set', async () => {
      userRepository.findOne.mockResolvedValue(
        buildUser({ mustChangePassword: true, passwordHash: 'hashed:initial-password' })
      );

      const refusal = userService.updateProfile('Tester', 'tester@example.com', 'initial-password', 1);

      await expect(issuesFrom(() => refusal)).resolves.toEqual([
        { path: 'password', name: 'Password', message: INITIAL_PASSWORD_REUSED_MESSAGE },
      ]);
      expect(userRepository.update).not.toHaveBeenCalled();
    });

    it('lets a user without the setup hold set the password they already hold', async () => {
      userRepository.findOne.mockResolvedValue(buildUser({ passwordHash: 'hashed:same-password' }));

      await userService.updateProfile('Tester', 'tester@example.com', 'same-password', 1);

      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({ passwordHash: 'hashed:same-password' })
      );
    });

    it('keeps the setup hold through a change that leaves the password alone', async () => {
      userRepository.findOne.mockResolvedValue(buildUser({ mustChangePassword: true }));

      await userService.updateProfile('Renamed', 'tester@example.com', undefined, 1);

      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, { name: 'Renamed', email: 'tester@example.com' });
    });

    it('keeps the session when the password is left alone', async () => {
      const user = buildUser();
      userRepository.findOne.mockResolvedValue(user);

      await userService.updateProfile('Renamed', 'tester@example.com', undefined, 1);

      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, { name: 'Renamed', email: 'tester@example.com' });
    });

    it('rejects an email already held by another user', async () => {
      userRepository.findOne
        .mockResolvedValueOnce(buildUser())
        .mockResolvedValueOnce(buildUser({ id: 2, email: 'taken@example.com' }));

      await expect(userService.updateProfile('Tester', 'taken@example.com', undefined, 1)).rejects.toThrow(
        BadRequestException
      );

      expect(userRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('startSession', () => {
    // The exact payload matters: unlike a login, starting a session leaves the timestamps alone.
    it('stores a new session uuid, signs it, and writes nothing else', async () => {
      userRepository.update.mockResolvedValue(undefined);
      createTokenMock.mockResolvedValue('signed-jwt');

      const token = await userService.startSession(buildUser());

      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, { sessionUuid: 'fixed-session-uuid' });
      expect(token).toBe('signed-jwt');
    });
  });

  describe('createLoginToken', () => {
    it('stores a new session uuid and asks the token service to sign it', async () => {
      const user = buildUser();
      userRepository.update.mockResolvedValue(undefined);
      createTokenMock.mockResolvedValue('signed-jwt');

      const token = await userService.createLoginToken(user);

      expect(vi.mocked(uuidv4 as UuidV4)).toHaveBeenCalled();
      expect(userRepository.update).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({
          sessionUuid: 'fixed-session-uuid',
          lastLoginSuccess: expect.any(Date) as Date,
        }) as Partial<User>
      );
      expect(createTokenMock).toHaveBeenCalledWith('fixed-session-uuid');
      expect(token).toBe('signed-jwt');
    });
  });

  describe('checkToken', () => {
    it('throws when the token cannot be decoded', async () => {
      decodeTokenMock.mockResolvedValue(null);

      await expect(userService.checkToken('bad-token')).rejects.toThrow(
        new UnauthorizedException(SESSION_EXPIRED_MESSAGE)
      );
      expect(userRepository.findOne).not.toHaveBeenCalled();
    });

    it('throws when no user matches the decoded session uuid', async () => {
      decodeTokenMock.mockResolvedValue({ sub: 'unknown-session' });
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.checkToken('any-token')).rejects.toThrow(
        new UnauthorizedException(SESSION_EXPIRED_MESSAGE)
      );
    });

    it('throws when the matched user is disabled', async () => {
      decodeTokenMock.mockResolvedValue({ sub: 'session-uuid' });
      userRepository.findOne.mockResolvedValue(buildUser({ enabled: false }));

      await expect(userService.checkToken('any-token')).rejects.toThrow(
        new UnauthorizedException('This account has been disabled')
      );
    });

    it('throws session-expired when the user has been idle for longer than the configured timeout', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-15T12:00:00Z');
      vi.setSystemTime(now);

      const lastAccess = new Date(now.getTime() - 16 * 60 * 1000);
      decodeTokenMock.mockResolvedValue({ sub: 'session-uuid' });
      userRepository.findOne.mockResolvedValue(buildUser({ lastAccess }));

      await expect(userService.checkToken('any-token')).rejects.toThrow(
        new UnauthorizedException(SESSION_EXPIRED_MESSAGE)
      );
    });

    it('returns the user and refreshes lastAccess on success', async () => {
      vi.useFakeTimers();
      const now = new Date('2026-05-15T12:00:00Z');
      vi.setSystemTime(now);

      const lastAccess = new Date(now.getTime() - 5 * 60 * 1000);
      const user = buildUser({ lastAccess });
      decodeTokenMock.mockResolvedValue({ sub: 'session-uuid' });
      userRepository.findOne.mockResolvedValue(user);

      const result = await userService.checkToken('any-token');

      expect(result).toBe(user);
      expect(userRepository.update).toHaveBeenCalledWith({ id: 1 }, {});
    });

    it('fetches the user with the userUserRoles relation', async () => {
      decodeTokenMock.mockResolvedValue({ sub: 'session-uuid' });
      userRepository.findOne.mockResolvedValue(buildUser());

      await userService.checkToken('any-token');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { sessionUuid: 'session-uuid' },
        relations: { userUserRoles: true },
      });
    });
  });

  describe('updateRoles', () => {
    it('throws when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(userService.updateRoles([UserRoleId.USER_ADMIN], 1)).rejects.toThrow(BadRequestException);
    });

    it('throws when one or more role ids are not recognised', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      userUserRoleRepository.delete.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([new UserRole(UserRoleId.USER_ADMIN, 'User Admin')]);

      await expect(userService.updateRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], 1)).rejects.toThrow(
        BadRequestException
      );

      expect(userUserRoleRepository.insert).not.toHaveBeenCalled();
    });

    it('clears existing roles before inserting the new set', async () => {
      userRepository.findOne.mockResolvedValue(buildUser());
      userUserRoleRepository.delete.mockResolvedValue(undefined);
      userRoleRepository.find.mockResolvedValue([
        new UserRole(UserRoleId.USER_ADMIN, 'User Admin'),
        new UserRole(UserRoleId.SYSTEM_ADMIN, 'System Admin'),
      ]);
      userUserRoleRepository.insert.mockResolvedValue(undefined);

      await userService.updateRoles([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN], 1);

      expect(userUserRoleRepository.delete).toHaveBeenCalledWith({ userId: 1 });
      expect(userUserRoleRepository.insert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ userId: 1, userRoleId: UserRoleId.USER_ADMIN })
      );
      expect(userUserRoleRepository.insert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ userId: 1, userRoleId: UserRoleId.SYSTEM_ADMIN })
      );
    });
  });

  describe('findNames', () => {
    it('maps each id it finds to its name', async () => {
      userRepository.find.mockResolvedValue([buildUser({ id: 7, name: 'Ada Whitfield' })]);

      const userNames = await userService.findNames([7, 8]);

      expect(userRepository.find).toHaveBeenCalledWith({ select: ['id', 'name'], where: { id: In([7, 8]) } });
      expect(userNames.get(7)).toBe('Ada Whitfield');
      expect(userNames.get(8)).toBeUndefined();
    });

    it('reads nothing when asked for no users', async () => {
      const userNames = await userService.findNames([]);

      expect(userRepository.find).not.toHaveBeenCalled();
      expect(userNames.size).toBe(0);
    });
  });

  describe('invalidateSessions', () => {
    it('clears the session uuid for the user', async () => {
      userRepository.update.mockResolvedValue(undefined);

      await userService.invalidateSessions(42);

      expect(userRepository.update).toHaveBeenCalledWith({ id: 42 }, { sessionUuid: null });
    });
  });
});
