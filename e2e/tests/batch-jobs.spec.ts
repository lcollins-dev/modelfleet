import { getBatchJobEnabled, getNewestBatchJobRunId, setBatchJobEnabled } from '../clients/batch-job.client';
import { expect, test } from '../fixtures/test';

const RESIDENCY_BATCH_JOB_ID = 100;
const RESIDENCY_BATCH_JOB_NAME = 'Residency';

test.describe('batch jobs', () => {
  test('lists the registered jobs and opens one', async ({ batchJobsPage, batchJobPage, page }) => {
    await batchJobsPage.goto();

    await expect(batchJobsPage.heading).toBeVisible();

    await batchJobsPage.rowByName(RESIDENCY_BATCH_JOB_NAME).click();

    await expect(page).toHaveURL(new RegExp(`/batch-jobs/${RESIDENCY_BATCH_JOB_ID}$`));
    await expect(batchJobPage.state).toBeVisible();
  });

  // The seeded job is shared, so these take turns and put its state back whether or not their assertions ran.
  test.describe('driving the job', () => {
    test.describe.configure({ mode: 'default' });

    let initialEnabled: boolean;

    test.beforeEach(async ({ request }) => {
      initialEnabled = await getBatchJobEnabled(request, RESIDENCY_BATCH_JOB_ID);
      await setBatchJobEnabled(request, RESIDENCY_BATCH_JOB_ID, true);
    });

    test.afterEach(async ({ request }) => {
      await setBatchJobEnabled(request, RESIDENCY_BATCH_JOB_ID, initialEnabled);
    });

    test('runs a job now and lists the run with its result without a reload', async ({ batchJobPage, request }) => {
      const newestBefore = await getNewestBatchJobRunId(request, RESIDENCY_BATCH_JOB_ID);

      await batchJobPage.goto(RESIDENCY_BATCH_JOB_ID);
      await expect(batchJobPage.runs.first().or(batchJobPage.noRuns)).toBeVisible();

      await batchJobPage.runNow.click();
      await batchJobPage.confirmRunNow.click();

      await expect.poll(() => getNewestBatchJobRunId(request, RESIDENCY_BATCH_JOB_ID)).not.toBe(newestBefore);
      await expect(batchJobPage.runs.first()).toContainText('Succeeded', { timeout: 10_000 });
      await expect(batchJobPage.noRuns).toBeHidden();
      await expect(batchJobPage.runCount).toHaveText(/^Showing 1-\d+ of \d+ runs?$/);
    });

    test('runs a job with no schedule by hand', async ({ batchJobPage, page, request }) => {
      await page.route(`**/api/v1/admin/batch-job/${RESIDENCY_BATCH_JOB_ID}`, async route => {
        const response = await route.fetch();
        const batchJob = (await response.json()) as Record<string, unknown>;

        await route.fulfill({ response, json: { ...batchJob, cronExpression: null } });
      });

      const newestBefore = await getNewestBatchJobRunId(request, RESIDENCY_BATCH_JOB_ID);

      await batchJobPage.goto(RESIDENCY_BATCH_JOB_ID);
      await expect(page.getByText('It has no schedule. Run it by hand with Run Now.')).toBeVisible();

      await batchJobPage.runNow.click();
      await batchJobPage.confirmRunNow.click();

      await expect.poll(() => getNewestBatchJobRunId(request, RESIDENCY_BATCH_JOB_ID)).not.toBe(newestBefore);
      await expect(batchJobPage.runs.first()).toContainText('Succeeded', { timeout: 10_000 });
    });

    test('disables and re-enables a job', async ({ batchJobPage, page }) => {
      await batchJobPage.goto(RESIDENCY_BATCH_JOB_ID);
      await expect(batchJobPage.state).toHaveText('Enabled');

      await batchJobPage.toggle.click();

      await expect(page.getByText('Job disabled')).toBeVisible();
      await expect(batchJobPage.state).toHaveText('Disabled');
      await expect(batchJobPage.toggle).toHaveAttribute('aria-checked', 'false');

      await batchJobPage.toggle.click();

      await expect(page.getByText('Job enabled')).toBeVisible();
      await expect(batchJobPage.state).toHaveText('Enabled');
    });
  });
});
