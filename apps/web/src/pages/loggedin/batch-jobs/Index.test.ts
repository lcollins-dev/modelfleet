import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BatchJobId, type BatchJobDto } from '@libs/dto';

import Index from './Index.vue';

const getBatchJobList = vi.fn();

vi.mock('@/services/api/admin/BatchJobAdminService', () => ({
  useBatchJobAdminService: () => ({ getBatchJobList, updateBatchJobState: vi.fn() }),
}));

const EARLIER = '2026-01-01T10:00:00Z';
const LATER = '2026-01-02T10:00:00Z';

const batchJobWith = (name: string, lastSuccessDate: string | null, lastFailDate: string | null): BatchJobDto => ({
  id: BatchJobId.RESIDENCY,
  name,
  desc: 'An example job.',
  cronExpression: '0 * * * *',
  enabled: true,
  lastStartDate: null,
  lastSuccessDate: lastSuccessDate === null ? null : new Date(lastSuccessDate),
  lastFailDate: lastFailDate === null ? null : new Date(lastFailDate),
});

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('Batch jobs page', () => {
  it('shows the result of each job by its last finished run', async () => {
    getBatchJobList.mockResolvedValue({
      batchJobList: [
        batchJobWith('Never run', null, null),
        batchJobWith('Last succeeded', LATER, EARLIER),
        batchJobWith('Last failed', EARLIER, LATER),
        batchJobWith('Only failed', null, EARLIER),
      ],
    });

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
    });
    await router.push('/batch-jobs');

    const wrapper = mount(Index, { global: { plugins: [router] } });
    await flushPromises();

    const rows = wrapper.findAll('[data-testid="job-row"]').map(row => row.text());

    expect(rows[0]).toContain('Not run yet');
    expect(rows[1]).toContain('Succeeded');
    expect(rows[2]).toContain('Failed');
    expect(rows[3]).toContain('Failed');
  });
});
