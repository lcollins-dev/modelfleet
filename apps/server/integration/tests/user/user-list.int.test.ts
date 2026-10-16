import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import { ListUserDto, UserStatsResponseDto, UserListStatus, UserRoleId } from '@libs/dto';

import { getUserList, getUserStats, login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';

describe('Admin user list (integration)', () => {
  let app: NestExpressApplication;
  let token: string;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
    token = await login(app, admin.email);
  });

  it('matches the search term against both name and email', async () => {
    // The suite shares a database, so a per-test token keeps the result set deterministic.
    const marker = randomUUID();

    const byName = await createTestUser(app, { name: `list-${marker}-name` });
    const byEmail = await createTestUser(app);

    const nameResponse = await getUserList(app, token, {
      search: `list-${marker}`,
      status: UserListStatus.ALL,
    }).expect(200);

    expect(nameResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([byName.id]);

    const emailResponse = await getUserList(app, token, {
      search: byEmail.email,
      status: UserListStatus.ALL,
    }).expect(200);

    expect(emailResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([byEmail.id]);
  });

  it('filters by status', async () => {
    const marker = randomUUID();

    const enabled = await createTestUser(app, { name: `status-${marker}-on`, enabled: true });
    const disabled = await createTestUser(app, { name: `status-${marker}-off`, enabled: false });

    const search = `status-${marker}`;

    const allResponse = await getUserList(app, token, { search, status: UserListStatus.ALL }).expect(200);
    const allIds = allResponse.body.userList.map((user: ListUserDto) => user.id);
    expect(allIds).toHaveLength(2);
    expect(allIds).toContain(enabled.id);
    expect(allIds).toContain(disabled.id);

    const enabledResponse = await getUserList(app, token, { search, status: UserListStatus.ENABLED }).expect(200);
    expect(enabledResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([enabled.id]);

    const disabledResponse = await getUserList(app, token, { search, status: UserListStatus.DISABLED }).expect(200);
    expect(disabledResponse.body.userList.map((user: ListUserDto) => user.id)).toEqual([disabled.id]);
  });

  it('rejects a request with an unknown status', async () => {
    await getUserList(app, token, { status: 'sideways' }).expect(400);
  });

  it('reports stats that split the total across enabled and disabled', async () => {
    await createTestUser(app, { enabled: false });

    const response = await getUserStats(app, token).expect(200);

    const { total, enabled, disabled } = response.body as UserStatsResponseDto;

    expect(total).toBe(enabled + disabled);
    expect(disabled).toBeGreaterThan(0);
  });
});
