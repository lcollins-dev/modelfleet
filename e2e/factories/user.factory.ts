import { type APIRequestContext, expect } from '@playwright/test';

import { adminHeaders } from '../utils/auth';
import { BASE_URL } from '../utils/urls';
import { ISignInCredentials, TEST_PASSWORD } from '../utils/users';

export interface ITestUser extends ISignInCredentials {
  id: number;
  name: string;
}

export interface ICreateTestUserOptions {
  name?: string;
  userRoleIds?: number[];
}

// Creates a user through the admin api so a spec that signs in gets a session of its own.
export const createTestUser = async (
  request: APIRequestContext,
  options: ICreateTestUserOptions = {}
): Promise<ITestUser> => {
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 100000)}@modelfleet.test`;
  const name = options.name ?? 'E2E User';

  const response = await request.post(`${BASE_URL}/api/v1/admin/user`, {
    headers: adminHeaders(),
    data: {
      name,
      email,
      password: TEST_PASSWORD,
      userRoleIds: options.userRoleIds ?? [],
    },
  });

  expect(response.status()).toBe(201);

  return { id: Number(await response.text()), name, email, password: TEST_PASSWORD };
};
