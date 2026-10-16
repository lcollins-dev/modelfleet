import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { login } from '../clients/user.client';
import { createTestUser } from '../factories/user.factory';
import { bootstrapApp } from '../setup';
import { authHeaders } from '../utils/auth';

const PROFILE_ROUTE = '/api/v1/user/profile';

describe('Request validation (integration)', () => {
  let app: NestExpressApplication;
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const user = await createTestUser(app);
    token = await login(app, user.email);

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    adminToken = await login(app, admin.email);
  });

  it('rejects a body missing a required property', async () => {
    await request(app.getHttpServer()).patch(PROFILE_ROUTE).set(authHeaders(token)).send({}).expect(400);
  });

  it('rejects a body carrying a property the schema does not name', async () => {
    await request(app.getHttpServer())
      .patch(PROFILE_ROUTE)
      .set(authHeaders(token))
      .send({ name: 'Valid Name', email: 'valid@modelfleet.test', notADeclaredField: 'nope' })
      .expect(400);
  });

  it('names the offending field in the validation response', async () => {
    const response = await request(app.getHttpServer())
      .patch(PROFILE_ROUTE)
      .set(authHeaders(token))
      .send({ name: 'x', email: 'valid@modelfleet.test' })
      .expect(400);

    expect(response.body.message).toEqual([
      { path: 'name', name: 'Name', message: 'Enter between 2 and 256 characters.' },
    ]);
  });

  it('answers without echoing the body it refused', async () => {
    const password = 'echoed-password-secret';

    const response = await request(app.getHttpServer())
      .post('/api/v1/user/login')
      .send({ email: 'not-an-email', password })
      .expect(400);

    expect(response.body.message).toEqual([{ path: 'email', name: 'Email', message: 'Enter a valid email address.' }]);
    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('rejects a non-numeric route parameter', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/user/not-a-number').set(authHeaders(adminToken)).expect(400);
  });

  it('rejects a route parameter beyond the int4 upper bound', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/user/2147483648').set(authHeaders(adminToken)).expect(400);
  });
});
