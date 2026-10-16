import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { getProfile, login } from '../../clients/user.client';
import { createTestUser, ITestUser, TEST_PASSWORD } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const updateProfile = (app: NestExpressApplication, token: string, body: Record<string, unknown>) =>
  request(app.getHttpServer()).patch('/api/v1/user/profile').set(authHeaders(token)).send(body);

describe('User profile (integration)', () => {
  let app: NestExpressApplication;
  let user: ITestUser;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    user = await createTestUser(app);
    token = await login(app, user.email);
  });

  it('returns the signed in users own profile', async () => {
    const response = await getProfile(app, token).expect(200);

    expect(response.body.email).toBe(user.email);
  });

  it('persists a name change', async () => {
    await updateProfile(app, token, { name: 'Renamed User', email: user.email }).expect(200);

    const rows = await dbQuery<{ name: string }>(app, 'select name from "user" where id = $1', [user.id]);

    expect(rows[0].name).toBe('Renamed User');
  });

  it('rejects a name below the minimum length', async () => {
    await updateProfile(app, token, { name: 'x', email: user.email }).expect(400);
  });

  it('rejects an email that is not an email', async () => {
    await updateProfile(app, token, { name: 'Valid Name', email: 'not-an-email' }).expect(400);
  });

  it('rejects a password that fails the complexity rule', async () => {
    await updateProfile(app, token, { name: 'Valid Name', email: user.email, password: 'weak' }).expect(400);
  });

  it('rejects an email already used by another user', async () => {
    const other = await createTestUser(app);

    await updateProfile(app, token, { name: 'Valid Name', email: other.email }).expect(400);
  });

  it('lets the user sign in with a changed password', async () => {
    const changer = await createTestUser(app);
    const changerToken = await login(app, changer.email);
    const newPassword = 'Chang3dPass!';

    await updateProfile(app, changerToken, {
      name: 'Password Changer',
      email: changer.email,
      password: newPassword,
    }).expect(200);

    await login(app, changer.email, newPassword);

    await request(app.getHttpServer())
      .post('/api/v1/user/login')
      .send({ email: changer.email, password: TEST_PASSWORD })
      .expect(400);
  });

  it('hands back a replacement token when the password changes', async () => {
    const changer = await createTestUser(app);
    const changerToken = await login(app, changer.email);

    const response = await updateProfile(app, changerToken, {
      name: 'Password Changer',
      email: changer.email,
      password: 'Chang3dPass!',
    }).expect(200);

    const replacement = String(response.body.token);

    expect(replacement.length).toBeGreaterThan(0);
    await getProfile(app, replacement).expect(200);
  });

  it('stops the token the password was changed from', async () => {
    const changer = await createTestUser(app);
    const changerToken = await login(app, changer.email);

    await updateProfile(app, changerToken, {
      name: 'Password Changer',
      email: changer.email,
      password: 'Chang3dPass!',
    }).expect(200);

    await getProfile(app, changerToken).expect(401);
  });

  it('hands back no replacement token when the password is left alone', async () => {
    const response = await updateProfile(app, token, { name: 'Still Signed In', email: user.email }).expect(200);

    expect(response.body.token).toBeUndefined();
    await getProfile(app, token).expect(200);
  });
});
