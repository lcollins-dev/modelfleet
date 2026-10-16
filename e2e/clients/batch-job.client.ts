import { type APIRequestContext, expect } from '@playwright/test';

import { adminHeaders } from '../utils/auth';
import { BASE_URL } from '../utils/urls';

// Reads and restores shared state directly, so a spec that mutates it can put it back even
// when the assertions between never ran.
export const getBatchJobEnabled = async (request: APIRequestContext, batchJobId: number): Promise<boolean> => {
  const response = await request.get(`${BASE_URL}/api/v1/admin/batch-job/${batchJobId}`, { headers: adminHeaders() });

  expect(response.status()).toBe(200);

  const body = (await response.json()) as { enabled: boolean };

  return body.enabled;
};

export const setBatchJobEnabled = async (
  request: APIRequestContext,
  batchJobId: number,
  enabled: boolean
): Promise<void> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/batch-job/${batchJobId}/state`, {
    headers: adminHeaders(),
    data: { enabled },
  });

  expect(response.status()).toBe(200);
};

export const getNewestBatchJobRunId = async (
  request: APIRequestContext,
  batchJobId: number
): Promise<number | null> => {
  const response = await request.get(`${BASE_URL}/api/v1/admin/batch-job/${batchJobId}/runs?page=1`, {
    headers: adminHeaders(),
  });

  expect(response.status()).toBe(200);

  const body = (await response.json()) as { batchJobRunList: { id: number }[] };

  return body.batchJobRunList.at(0)?.id ?? null;
};
