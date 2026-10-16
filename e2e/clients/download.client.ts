import { type APIRequestContext, expect } from '@playwright/test';

import { adminHeaders } from '../utils/auth';
import { BASE_URL } from '../utils/urls';

interface IDownloadSummary {
  id: number;
  targets: { nodeId: number }[];
}

/** Stops and dismisses every download that names the node, so a failed spec leaves nothing behind. */
export const clearDownloadsFor = async (request: APIRequestContext, nodeId: number): Promise<void> => {
  const response = await request.patch(`${BASE_URL}/api/v1/admin/download/list?page=1`, {
    headers: adminHeaders(),
    data: {},
  });

  expect(response.status()).toBe(200);

  const { downloadList } = (await response.json()) as { downloadList: IDownloadSummary[] };

  for (const download of downloadList.filter(entry => entry.targets.some(target => target.nodeId === nodeId))) {
    await request.post(`${BASE_URL}/api/v1/admin/download/${download.id}/stop`, { headers: adminHeaders(), data: {} });
    await request.delete(`${BASE_URL}/api/v1/admin/download/${download.id}`, { headers: adminHeaders() });
  }
};
