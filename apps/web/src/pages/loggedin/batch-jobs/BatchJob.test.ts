import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId, BatchJobRunResult, type BatchJobDto, type BatchJobRunDto } from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';

import BatchJob from './BatchJob.vue';

const mocks = vi.hoisted(() => ({
  getBatchJob: vi.fn(),
  getBatchJobRunList: vi.fn(),
  updateBatchJobState: vi.fn(),
  runBatchJob: vi.fn(),
}));

vi.mock('vue-router', async importOriginal => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { batchJobId: '100' } }),
}));

vi.mock('@/services/api/admin/BatchJobAdminService', () => ({
  useBatchJobAdminService: () => mocks,
}));

const POLL_MS = 2000;

const BATCH_JOB: BatchJobDto = {
  id: BatchJobId.RESIDENCY,
  name: 'Residency',
  desc: 'Residency batch job',
  cronExpression: '0 * * * *',
  enabled: true,
  lastStartDate: null,
  lastSuccessDate: null,
  lastFailDate: null,
};

const buildRun = (result: BatchJobRunResult): BatchJobRunDto => ({
  id: 4,
  startDate: new Date('2026-10-02T13:47:00Z'),
  endDate: result === BatchJobRunResult.RUNNING ? null : new Date('2026-10-02T13:47:03Z'),
  result,
  error: null,
});

const runsResponse = (...runs: BatchJobRunDto[]) => ({ batchJobRunList: runs, pages: 1, total: runs.length });

const mountPage = async () => {
  const wrapper = mount(BatchJob, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });

  await flushPromises();

  return wrapper;
};

type PageWrapper = Awaited<ReturnType<typeof mountPage>>;

const runNowButton = (wrapper: PageWrapper) => {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === 'Run Now');

  if (button === undefined) {
    throw new Error('No Run Now button');
  }

  return button;
};

const confirmDialog = async () => {
  const dialogStore = useDialogStore();
  const dialog = dialogStore.top!;

  await dialog.options.action?.();
  dialogStore.close(dialog, true);
};

const runRows = (wrapper: PageWrapper) => wrapper.findAll('[data-testid="job-run"]');

describe('Batch job page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createPinia());

    mocks.getBatchJob.mockResolvedValue(BATCH_JOB);
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says so when the job hasn't run", async () => {
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain("This job hasn't run yet.");
    expect(mocks.getBatchJobRunList).toHaveBeenCalledWith(BatchJobId.RESIDENCY, 1);
  });

  it('asks before running, then lists the run it started', async () => {
    mocks.runBatchJob.mockResolvedValue(buildRun(BatchJobRunResult.RUNNING));
    const wrapper = await mountPage();

    await runNowButton(wrapper).trigger('click');

    expect(useDialogStore().top?.options.title).toBe('Run Residency now?');
    expect(mocks.runBatchJob).not.toHaveBeenCalled();

    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await confirmDialog();
    await flushPromises();

    expect(mocks.runBatchJob).toHaveBeenCalledWith(BatchJobId.RESIDENCY);
    expect(runRows(wrapper)).toHaveLength(1);
    expect(runRows(wrapper)[0].text()).toContain('Running');
  });

  it('follows a running run to its result, then reloads the job once and stops', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    const wrapper = await mountPage();

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJobRunList).toHaveBeenCalledTimes(2);
    expect(mocks.getBatchJob).toHaveBeenCalledTimes(1);

    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.SUCCEEDED)));
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(runRows(wrapper)[0].text()).toContain('Succeeded');
    expect(mocks.getBatchJob).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocks.getBatchJobRunList).toHaveBeenCalledTimes(3);
  });

  it('keeps following a run through a failed reload', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    await mountPage();

    mocks.getBatchJobRunList.mockRejectedValueOnce(new Error('Network Error'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mocks.getBatchJobRunList).toHaveBeenCalledTimes(3);
  });

  it('stops following when the page closes', async () => {
    mocks.getBatchJobRunList.mockResolvedValue(runsResponse(buildRun(BatchJobRunResult.RUNNING)));
    const wrapper = await mountPage();

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(mocks.getBatchJobRunList).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and lists no run when the run is refused', async () => {
    const refusal = new Error('This batch job is already running.');
    mocks.runBatchJob.mockRejectedValue(refusal);
    const wrapper = await mountPage();

    await runNowButton(wrapper).trigger('click');

    await expect(useDialogStore().top?.options.action?.()).rejects.toThrow(refusal);
    expect(runRows(wrapper)).toHaveLength(0);
  });

  it('offers Run Now for a job with no schedule', async () => {
    mocks.getBatchJob.mockResolvedValue({ ...BATCH_JOB, cronExpression: null });
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('It has no schedule. Run it by hand with Run Now.');
    expect(runNowButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('counts the runs on the page against the total', async () => {
    const runs = Array.from({ length: 20 }, () => buildRun(BatchJobRunResult.SUCCEEDED));
    mocks.getBatchJobRunList.mockResolvedValue({ batchJobRunList: runs, pages: 3, total: 45 });
    const wrapper = await mountPage();

    expect(wrapper.get('[data-testid="run-count"]').text()).toBe('Showing 1-20 of 45 runs');

    mocks.getBatchJobRunList.mockResolvedValue({ batchJobRunList: runs.slice(0, 5), pages: 3, total: 45 });
    await wrapper.get('[aria-label="Page 3"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="run-count"]').text()).toBe('Showing 41-45 of 45 runs');
  });

  it('leaves the count out until the job has run', async () => {
    const wrapper = await mountPage();

    expect(wrapper.find('[data-testid="run-count"]').exists()).toBe(false);
  });
});
