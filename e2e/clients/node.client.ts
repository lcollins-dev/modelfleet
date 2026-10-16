import { type APIRequestContext, expect } from '@playwright/test';

import { adminHeaders } from '../utils/auth';
import { BASE_URL } from '../utils/urls';

export interface IRegisteredNode {
  id: number;
  name: string;
  nodeKey: string;
  secret: string;
}

export const registerNode = async (request: APIRequestContext, name: string): Promise<IRegisteredNode> => {
  const response = await request.post(`${BASE_URL}/api/v1/admin/node`, {
    headers: adminHeaders(),
    data: { name },
  });

  expect(response.status()).toBe(201);

  return (await response.json()) as IRegisteredNode;
};

export const deleteNode = async (request: APIRequestContext, nodeId: number): Promise<void> => {
  const response = await request.delete(`${BASE_URL}/api/v1/admin/node/${nodeId}`, { headers: adminHeaders() });

  expect(response.status()).toBe(200);
};

export const renameNode = async (request: APIRequestContext, nodeId: number, name: string): Promise<void> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/node/${nodeId}`, {
    headers: adminHeaders(),
    data: { name, description: '' },
  });

  expect(response.status()).toBe(200);
};
