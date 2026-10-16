import { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';

import { UserRoleId } from '@libs/dto';

import { dbQuery } from '../utils/db';

export const TEST_PASSWORD = 'TestPass123!';

// bcrypt hash of TEST_PASSWORD, precomputed so fixtures do not pay for hashing.
const TEST_PASSWORD_HASH = '$2b$10$PoDNPA1sN1W6k732WHoO3.kXnbbYbtDTYWwID58wZaU4Gxq.6XpT6';

export interface ITestUser {
  id: number;
  email: string;
  name: string;
}

export interface ICreateTestUserOptions {
  roleIds?: UserRoleId[];
  enabled?: boolean;
  name?: string;
  mustChangePassword?: boolean;
}

export const createTestUser = async (
  app: NestExpressApplication,
  options: ICreateTestUserOptions = {}
): Promise<ITestUser> => {
  const { roleIds = [], enabled = true, mustChangePassword = false } = options;

  const email = `int-test-${randomUUID()}@modelfleet.test`;
  const name = options.name ?? email;

  const rows = await dbQuery<{ id: number }>(
    app,
    `INSERT INTO "user" ("name", "email", "passwordHash", "enabled", "mustChangePassword")
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [name, email, TEST_PASSWORD_HASH, enabled, mustChangePassword]
  );

  const id = rows[0].id;

  for (const roleId of roleIds) {
    await dbQuery(app, 'INSERT INTO "user_user_role" ("userId", "userRoleId") VALUES ($1, $2)', [id, roleId]);
  }

  return { id, email, name };
};
