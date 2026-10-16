import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { SETUP_REQUIRED_MESSAGE } from '@/api/v1/user/guards/auth.guard';

import { getNotificationList } from '../../clients/notification.client';
import { getProfile, getUserStats, login, logout } from '../../clients/user.client';
import { createTestUser, ITestUser, TEST_PASSWORD } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const NEW_PASSWORD = 'S3tup$Done';

const updateProfile = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch('/api/v1/user/profile').set(authHeaders(token)).send(body);

describe('Password change required (integration)', () => {
  let app: NestExpressApplication;
  let user: ITestUser;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    user = await createTestUser(app, {
      roleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
      mustChangePassword: true,
    });
    token = await login(app, user.email);
  });

  it('leaves the seeded admin unheld under the test migrations', async () => {
    const rows = await dbQuery<{ mustChangePassword: boolean }>(
      app,
      'SELECT "mustChangePassword" FROM "user" WHERE email = $1',
      ['admin@modelfleet.test']
    );

    expect(rows).toEqual([{ mustChangePassword: false }]);
  });

  it('reports the hold on the profile', async () => {
    const response = await getProfile(app, token).expect(200);

    expect(response.body).toMatchObject({ email: user.email, mustChangePassword: true });
  });

  it('refuses every other route with 403 setup required, admin roles notwithstanding', async () => {
    for (const refusal of [() => getUserStats(app, token), () => getNotificationList(app, token)]) {
      const response = await refusal().expect(403);

      expect(response.body.message).toBe(SETUP_REQUIRED_MESSAGE);
    }
  });

  it('keeps the hold through a profile change that leaves the password alone', async () => {
    await updateProfile(app, token, { name: 'Held Admin', email: user.email }).expect(200);

    const response = await getProfile(app, token).expect(200);

    expect(response.body).toMatchObject({ name: 'Held Admin', mustChangePassword: true });
  });

  it('refuses the initial password as the new one on the password field', async () => {
    const response = await updateProfile(app, token, {
      name: 'Held Admin',
      email: user.email,
      password: TEST_PASSWORD,
    }).expect(400);

    expect(response.body.message).toEqual([
      { path: 'password', name: 'Password', message: 'Choose a new password, not the one you signed in with' },
    ]);

    await getUserStats(app, token).expect(403);
  });

  it('signs out while held', async () => {
    await logout(app, token).expect(201);
    await getProfile(app, token).expect(401);

    token = await login(app, user.email);
  });

  it('lifts the hold with a password change, after which every route is open', async () => {
    const response = await updateProfile(app, token, {
      name: 'Held Admin',
      email: user.email,
      password: NEW_PASSWORD,
    }).expect(200);

    token = String(response.body.token);

    const profile = await getProfile(app, token).expect(200);
    expect(profile.body.mustChangePassword).toBe(false);

    const rows = await dbQuery<{ mustChangePassword: boolean }>(
      app,
      'SELECT "mustChangePassword" FROM "user" WHERE id = $1',
      [user.id]
    );
    expect(rows[0].mustChangePassword).toBe(false);

    await getUserStats(app, token).expect(200);
    await getNotificationList(app, token).expect(200);
    await login(app, user.email, NEW_PASSWORD);
  });
});
