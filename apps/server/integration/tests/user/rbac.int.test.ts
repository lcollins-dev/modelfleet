import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { getUserRoles, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';

const ADMIN_ROUTE = '/api/v1/admin/user/role/list';

describe('Admin route RBAC (integration)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await bootstrapApp();
  });

  it('rejects an unauthenticated request to an admin-only route', async () => {
    await request(app.getHttpServer()).get(ADMIN_ROUTE).expect(401);
  });

  it('rejects a user lacking the USER_ADMIN role', async () => {
    const user = await createTestUser(app);
    const token = await login(app, user.email);

    const response = await getUserRoles(app, token).expect(403);

    expect(response.body.message).toBe('You do not have permission to do this');
  });

  it('allows a user holding the USER_ADMIN role', async () => {
    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    const token = await login(app, admin.email);

    const response = await getUserRoles(app, token).expect(200);

    expect(Array.isArray(response.body)).toBe(true);
  });
});
