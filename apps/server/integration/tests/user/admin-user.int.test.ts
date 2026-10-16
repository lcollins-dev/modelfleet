import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import {
  createUser,
  getProfile,
  getUser,
  login,
  loginRequest,
  logoutAllSessions,
  updateUser,
  updateUserState,
} from '../../clients/user.client';
import { createTestUser, TEST_PASSWORD } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { dbQuery } from '../../utils/db';

const NEW_PASSWORD = 'An0ther$Pass';

const buildCreateBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Created User',
  email: `int-admin-${randomUUID()}@modelfleet.test`,
  password: TEST_PASSWORD,
  userRoleIds: [],
  ...overrides,
});

describe('Admin user management (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  describe('creating', () => {
    it('creates a user who can then sign in', async () => {
      const body = buildCreateBody();

      const response = await createUser(app, token, body).expect(201);

      expect(Number(response.text)).toBeGreaterThan(0);

      await login(app, body.email);
    });

    it('stores the requested roles', async () => {
      const body = buildCreateBody({ userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN] });

      const response = await createUser(app, token, body).expect(201);

      const created = await getUser(app, token, Number(response.text)).expect(200);

      expect(created.body.userRoleIds).toEqual(
        expect.arrayContaining([UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN])
      );
    });

    it('stores the password as a hash', async () => {
      const body = buildCreateBody();

      const response = await createUser(app, token, body).expect(201);

      const rows = await dbQuery<{ passwordHash: string }>(app, 'SELECT "passwordHash" FROM "user" WHERE id = $1', [
        Number(response.text),
      ]);

      expect(rows[0].passwordHash).not.toBe(TEST_PASSWORD);
    });

    it('rejects a duplicate email', async () => {
      const body = buildCreateBody();

      await createUser(app, token, body).expect(201);
      await createUser(app, token, body).expect(400);
    });

    it('rejects an email that differs only by case', async () => {
      const body = buildCreateBody();

      await createUser(app, token, body).expect(201);
      await createUser(app, token, { ...body, email: body.email.toUpperCase() }).expect(400);
    });

    it('rejects a malformed email', async () => {
      await createUser(app, token, buildCreateBody({ email: 'not-an-email' })).expect(400);
    });

    it('rejects a password that fails the complexity rule', async () => {
      await createUser(app, token, buildCreateBody({ password: 'weak' })).expect(400);
    });

    it('rejects a role id that is not a known role', async () => {
      await createUser(app, token, buildCreateBody({ userRoleIds: [9999] })).expect(400);
    });
  });

  describe('reading', () => {
    it('returns the user with role ids and serialised dates', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        enabled: true,
        userRoleIds: [UserRoleId.USER_ADMIN],
      });
      expect(typeof response.body.createdDate).toBe('string');
      expect(response.body.lastLoginSuccess).toBeNull();
    });

    it('records the last successful login once the user signs in', async () => {
      const user = await createTestUser(app);
      await login(app, user.email);

      const response = await getUser(app, token, user.id).expect(200);

      expect(typeof response.body.lastLoginSuccess).toBe('string');
    });

    it('rejects a user id that does not exist', async () => {
      await getUser(app, token, 2147483647).expect(400);
    });

    it('rejects a user id that is not an integer', async () => {
      await getUser(app, token, 'abc').expect(400);
    });
  });

  describe('updating', () => {
    it('renames the user and replaces the role set', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      await updateUser(app, token, user.id, {
        name: 'Renamed',
        email: user.email,
        userRoleIds: [UserRoleId.SYSTEM_ADMIN],
      }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body.name).toBe('Renamed');
      expect(response.body.userRoleIds).toEqual([UserRoleId.SYSTEM_ADMIN]);
    });

    it('strips every role when an empty set is sent', async () => {
      const user = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });

      await updateUser(app, token, user.id, { name: user.name, email: user.email, userRoleIds: [] }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);

      expect(response.body.userRoleIds).toEqual([]);
    });

    it('changes the password the user signs in with', async () => {
      const user = await createTestUser(app);

      await updateUser(app, token, user.id, {
        name: user.name,
        email: user.email,
        password: NEW_PASSWORD,
        userRoleIds: [],
      }).expect(200);

      await login(app, user.email, NEW_PASSWORD);
    });

    it('ends a session held against the old password', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);

      await updateUser(app, token, user.id, {
        name: user.name,
        email: user.email,
        password: NEW_PASSWORD,
        userRoleIds: [],
      }).expect(200);

      await getProfile(app, userToken).expect(401);
    });

    it('leaves a session alone when the update carries no password', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await updateUser(app, token, user.id, { name: 'Renamed', email: user.email, userRoleIds: [] }).expect(200);

      await getProfile(app, userToken).expect(200);
    });

    it('leaves the password alone when the request omits it', async () => {
      const user = await createTestUser(app);

      await updateUser(app, token, user.id, { name: 'Renamed', email: user.email, userRoleIds: [] }).expect(200);

      await login(app, user.email);
    });

    it('rejects an email already held by another user', async () => {
      const user = await createTestUser(app);
      const other = await createTestUser(app);

      await updateUser(app, token, user.id, { name: user.name, email: other.email, userRoleIds: [] }).expect(400);
    });

    it('rejects a user id that does not exist', async () => {
      await updateUser(app, token, 2147483647, {
        name: 'Ghost',
        email: `int-admin-${randomUUID()}@modelfleet.test`,
        userRoleIds: [],
      }).expect(400);
    });
  });

  describe('enabling and disabling', () => {
    it('records the account as disabled', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      const response = await getUser(app, token, user.id).expect(200);
      expect(response.body.enabled).toBe(false);

      const rows = await dbQuery<{ enabled: boolean }>(app, 'SELECT enabled FROM "user" WHERE id = $1', [user.id]);
      expect(rows[0].enabled).toBe(false);
    });

    it('refuses to sign a disabled account in', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      const response = await loginRequest(app, { email: user.email, password: TEST_PASSWORD }).expect(400);

      expect(response.body.message).toBe('This account has been disabled');
    });

    it('keeps a wrong password on a disabled account indistinguishable from any bad login', async () => {
      const user = await createTestUser(app, { enabled: false });

      const response = await loginRequest(app, { email: user.email, password: 'not-the-password' }).expect(400);

      expect(response.body.message).not.toBe('This account has been disabled');
    });

    it('invalidates the session of a user who is disabled after signing in', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);

      await updateUserState(app, token, user.id, { enabled: false }).expect(200);

      await getProfile(app, userToken).expect(401);
    });

    it('lets a re-enabled user back in', async () => {
      const user = await createTestUser(app, { enabled: false });

      await updateUserState(app, token, user.id, { enabled: true }).expect(200);

      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);
    });

    it('rejects a non-boolean enabled flag', async () => {
      const user = await createTestUser(app);

      await updateUserState(app, token, user.id, { enabled: 'yes' }).expect(400);
    });

    it('rejects a user id that does not exist', async () => {
      await updateUserState(app, token, 2147483647, { enabled: false }).expect(400);
    });
  });

  describe('logging out every session', () => {
    it('invalidates the token the user is holding', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getProfile(app, userToken).expect(200);

      await logoutAllSessions(app, token, user.id).expect(200);

      await getProfile(app, userToken).expect(401);
    });

    it('leaves the user able to sign in again', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await logoutAllSessions(app, token, user.id).expect(200);

      const freshToken = await login(app, user.email);

      expect(freshToken).not.toBe(userToken);
      await getProfile(app, freshToken).expect(200);
    });
  });
});
