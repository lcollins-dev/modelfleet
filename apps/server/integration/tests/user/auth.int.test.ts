import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { getProfile, login, loginRequest, logout } from '../../clients/user.client';
import { createTestUser, ITestUser, TEST_PASSWORD } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';

const PROFILE_ROUTE = '/api/v1/user/profile';
const SESSION_EXPIRED_MESSAGE = 'Your session is invalid or has expired. Sign in to continue';
const INVALID_LOGIN_ISSUE = {
  path: 'password',
  name: 'Password',
  message: 'The email address or password is incorrect',
};

describe('Auth guard over the real request path (integration)', () => {
  let app: NestExpressApplication;
  let user: ITestUser;

  beforeAll(async () => {
    app = await bootstrapApp();

    user = await createTestUser(app);
  });

  it('rejects a request with no authorization header', async () => {
    const response = await request(app.getHttpServer()).get(PROFILE_ROUTE).expect(401);

    expect(response.body.message).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it('rejects a token that is not a jwt', async () => {
    await request(app.getHttpServer()).get(PROFILE_ROUTE).set(authHeaders('not-a-token')).expect(401);
  });

  it('rejects a token whose payload names an unknown session', async () => {
    const token = await login(app, user.email);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'no-such-session' })).toString('base64url');

    await request(app.getHttpServer())
      .get(PROFILE_ROUTE)
      .set(authHeaders(`${header}.${forgedPayload}.${signature}`))
      .expect(401);
  });

  it('allows a guarded route with a token from the login route', async () => {
    const token = await login(app, user.email);

    const response = await getProfile(app, token).expect(200);

    expect(response.body.email).toBe(user.email);
  });

  it('refuses a wrong password on the password field', async () => {
    const response = await loginRequest(app, { email: user.email, password: 'wrong-password' }).expect(400);

    expect(response.body.message).toEqual([INVALID_LOGIN_ISSUE]);
  });

  it('refuses an unknown email exactly as a wrong password', async () => {
    const response = await loginRequest(app, { email: 'nobody@example.com', password: 'wrong-password' }).expect(400);

    expect(response.body.message).toEqual([INVALID_LOGIN_ISSUE]);
  });

  it('rejects a login for a disabled user', async () => {
    const disabled = await createTestUser(app, { enabled: false });

    const response = await loginRequest(app, { email: disabled.email, password: TEST_PASSWORD }).expect(400);

    expect(response.body.message).toBe('This account has been disabled');
  });

  it('invalidates the token after logging out', async () => {
    const separate = await createTestUser(app);
    const token = await login(app, separate.email);

    await getProfile(app, token).expect(200);
    await logout(app, token).expect(201);

    await getProfile(app, token).expect(401);
  });

  it('issues a fresh session on each login, invalidating the previous token', async () => {
    const separate = await createTestUser(app);

    const firstToken = await login(app, separate.email, TEST_PASSWORD);
    const secondToken = await login(app, separate.email, TEST_PASSWORD);

    await getProfile(app, secondToken).expect(200);
    await getProfile(app, firstToken).expect(401);
  });
});
