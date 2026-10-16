import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId, BatchJobRunResult, BatchJobDto, BatchJobRunDto, UserRoleId } from '@libs/dto';

import { BatchJobRunner, BatchJobService } from '@/core/batch-job/batch-job.service';

import {
  getBatchJob,
  getBatchJobList,
  getBatchJobRunList,
  runBatchJob,
  updateBatchJobState,
} from '../../clients/batch-job.client';
import { login } from '../../clients/user.client';
import { createTestUser } from '../../factories/user.factory';
import { bootstrapApp } from '../../setup';
import { authHeaders } from '../../utils/auth';
import { dbQuery } from '../../utils/db';

const BATCH_JOB_LIST_ROUTE = '/api/v1/admin/batch-job/list';
const UNREGISTERED_JOB_ID = 999;
const HISTORY_SIZE = 100;
const SUCCEEDED_HISTORY_SIZE = 10;
const PAGE_SIZE = 20;
const AWAIT_RUN_OPTIONS = { timeout: 10_000, interval: 100 };

// Residency passes over every deployment, acting between other specs' steps, so runs here go through a job
// of the spec's own.
const TEST_JOB_ID = 990;

class HeldRunner extends BatchJobRunner {
  private held: Promise<void> | null = null;
  private failNext = false;

  hold(): () => void {
    let release: () => void = () => undefined;

    this.held = new Promise<void>(resolve => {
      release = resolve;
    });

    return () => release();
  }

  failNextRun(): void {
    this.failNext = true;
  }

  async run(): Promise<void> {
    const held = this.held;
    this.held = null;

    if (held !== null) {
      await held;
    }

    if (this.failNext) {
      this.failNext = false;
      throw new Error('Told to fail');
    }
  }
}

describe('Batch job admin routes (integration)', () => {
  let app: NestExpressApplication;
  let token: string;
  let runner: HeldRunner;

  beforeAll(async () => {
    app = await bootstrapApp();

    const admin = await createTestUser(app, { roleIds: [UserRoleId.SYSTEM_ADMIN] });
    token = await login(app, admin.email);

    await dbQuery(app, 'INSERT INTO batch_job (id, "name", "desc", enabled) VALUES ($1, $2, $3, true)', [
      TEST_JOB_ID,
      'Held',
      'A job whose runs the spec holds or fails',
    ]);

    runner = new HeldRunner();
    await app.get(BatchJobService).registerBatchJob(TEST_JOB_ID as BatchJobId, null, runner);
  });

  afterAll(async () => {
    // This hook runs even when beforeAll failed before assigning app, so it resolves the
    // shared app itself rather than reading a variable that may never have been set. The suite
    // leaves residency disabled, since a tick of it would act between another spec's steps.
    const sharedApp = await bootstrapApp();

    await dbQuery(sharedApp, 'UPDATE batch_job SET enabled = false WHERE id = $1', [BatchJobId.RESIDENCY]);
    await dbQuery(sharedApp, 'DELETE FROM batch_job WHERE id = $1', [TEST_JOB_ID]);
  });

  const listRuns = async (page = 1): Promise<BatchJobRunDto[]> => {
    const response = await getBatchJobRunList(app, token, TEST_JOB_ID, page).expect(200);

    return response.body.batchJobRunList;
  };

  const awaitRun = (runId: number): Promise<BatchJobRunDto> =>
    vi.waitFor(async () => {
      const [newest] = await listRuns();

      expect(newest.id).toBe(runId);
      expect(newest.result).not.toBe(BatchJobRunResult.RUNNING);

      return newest;
    }, AWAIT_RUN_OPTIONS);

  const runAndAwaitRun = async (): Promise<BatchJobRunDto> => {
    const response = await runBatchJob(app, token, TEST_JOB_ID).expect(202);

    return awaitRun(response.body.id);
  };

  const runCount = async (result: BatchJobRunResult): Promise<number> => {
    const [row] = await dbQuery<{ count: number }>(
      app,
      'SELECT COUNT(*)::int AS count FROM batch_job_run WHERE "batchJobId" = $1 AND "result" = $2',
      [TEST_JOB_ID, result]
    );

    return row.count;
  };

  describe('access', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get(BATCH_JOB_LIST_ROUTE).expect(401);
    });

    it('rejects a user with no roles', async () => {
      const user = await createTestUser(app);
      const userToken = await login(app, user.email);

      await getBatchJobList(app, userToken).expect(403);
    });

    it('rejects a USER_ADMIN who is not a SYSTEM_ADMIN', async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await getBatchJobList(app, adminToken).expect(403);
    });

    it("rejects a USER_ADMIN reading a job's runs", async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await getBatchJobRunList(app, adminToken, TEST_JOB_ID).expect(403);
    });

    it('rejects a USER_ADMIN running a job', async () => {
      const admin = await createTestUser(app, { roleIds: [UserRoleId.USER_ADMIN] });
      const adminToken = await login(app, admin.email);

      await runBatchJob(app, adminToken, TEST_JOB_ID).expect(403);
    });
  });

  describe('reading', () => {
    it('lists the seeded jobs', async () => {
      const response = await getBatchJobList(app, token).expect(200);

      const ids = response.body.batchJobList.map((batchJob: BatchJobDto) => batchJob.id);

      expect(ids).toContain(BatchJobId.RESIDENCY);
    });

    it('returns a single job with its schedule and run history', async () => {
      const response = await getBatchJob(app, token, BatchJobId.RESIDENCY).expect(200);

      expect(response.body).toMatchObject({
        id: BatchJobId.RESIDENCY,
        enabled: expect.any(Boolean) as boolean,
      });
      expect(response.body).toHaveProperty('cronExpression');
      expect(response.body).toHaveProperty('lastStartDate');
      expect(response.body).toHaveProperty('lastSuccessDate');
      expect(response.body).toHaveProperty('lastFailDate');
    });

    it('rejects a job id that does not exist', async () => {
      await getBatchJob(app, token, 2147483647).expect(400);
    });

    it('rejects a job id that is not an integer', async () => {
      await getBatchJob(app, token, 'abc').expect(400);
    });
  });

  describe('updating state', () => {
    // Enables before disabling, so the suite hands the job back the way it found it: off.
    it('enables and disables the job', async () => {
      await updateBatchJobState(app, token, BatchJobId.RESIDENCY, { enabled: true }).expect(200);

      const enabled = await getBatchJob(app, token, BatchJobId.RESIDENCY).expect(200);
      expect(enabled.body.enabled).toBe(true);

      await updateBatchJobState(app, token, BatchJobId.RESIDENCY, { enabled: false }).expect(200);

      const disabled = await getBatchJob(app, token, BatchJobId.RESIDENCY).expect(200);
      expect(disabled.body.enabled).toBe(false);
    });

    it('rejects a non-boolean enabled flag', async () => {
      await updateBatchJobState(app, token, BatchJobId.RESIDENCY, { enabled: 'yes' }).expect(400);
    });

    it('rejects a missing enabled flag', async () => {
      await updateBatchJobState(app, token, BatchJobId.RESIDENCY, {}).expect(400);
    });

    it('rejects a job id that does not exist', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/admin/batch-job/2147483647/state')
        .set(authHeaders(token))
        .send({ enabled: false })
        .expect(400);
    });
  });

  describe('running now', () => {
    it('rejects a job that has no runner registered', async () => {
      await dbQuery(app, 'INSERT INTO batch_job (id, "name", "desc", enabled) VALUES ($1, $2, $3, true)', [
        UNREGISTERED_JOB_ID,
        'Unregistered',
        'A job with no runner behind it',
      ]);

      try {
        const response = await runBatchJob(app, token, UNREGISTERED_JOB_ID).expect(400);

        expect(response.body.message).toBe('This batch job has not been registered');
      } finally {
        await dbQuery(app, 'DELETE FROM batch_job WHERE id = $1', [UNREGISTERED_JOB_ID]);
      }
    });

    it('rejects a job id that does not exist', async () => {
      await runBatchJob(app, token, 2147483647).expect(400);
    });

    it('answers the run it opened at once, as running, for a job with no schedule', async () => {
      const job = await getBatchJob(app, token, TEST_JOB_ID).expect(200);
      expect(job.body.cronExpression).toBeNull();

      const release = runner.hold();

      const response = await runBatchJob(app, token, TEST_JOB_ID).expect(202);

      expect(response.body).toEqual({
        id: expect.any(Number) as number,
        startDate: expect.any(String) as string,
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });

      release();

      await expect(awaitRun(response.body.id)).resolves.toMatchObject({ result: BatchJobRunResult.SUCCEEDED });
    });

    it('refuses a second run while the first is going, and accepts one once it has closed', async () => {
      const release = runner.hold();

      const first = await runBatchJob(app, token, TEST_JOB_ID).expect(202);

      try {
        const refused = await runBatchJob(app, token, TEST_JOB_ID).expect(400);
        expect(refused.body.message).toBe('This batch job is already running');
      } finally {
        release();
      }

      await awaitRun(first.body.id);

      await runAndAwaitRun();
    });
  });

  describe('run history', () => {
    beforeEach(async () => {
      await dbQuery(app, 'DELETE FROM batch_job_run WHERE "batchJobId" = $1', [TEST_JOB_ID]);
    });

    it('records each run with its start, end and result, newest first', async () => {
      const first = await runAndAwaitRun();
      const second = await runAndAwaitRun();

      expect(second).toEqual({
        id: expect.any(Number) as number,
        startDate: expect.any(String) as string,
        endDate: expect.any(String) as string,
        result: BatchJobRunResult.SUCCEEDED,
        error: null,
      });

      const runs = await listRuns();

      expect(runs.map(run => run.id)).toEqual([second.id, first.id]);
      expect(new Date(second.endDate ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(second.startDate).getTime());

      const job = await getBatchJob(app, token, TEST_JOB_ID).expect(200);
      expect(new Date(job.body.lastSuccessDate).getTime()).toBe(new Date(second.endDate ?? 0).getTime());
    });

    it('records a failed run with its message and turns the job off', async () => {
      runner.failNextRun();

      const failed = await runAndAwaitRun();

      expect(failed).toMatchObject({ result: BatchJobRunResult.FAILED, error: 'Told to fail' });

      const job = await getBatchJob(app, token, TEST_JOB_ID).expect(200);
      expect(job.body.enabled).toBe(false);

      await updateBatchJobState(app, token, TEST_JOB_ID, { enabled: true }).expect(200);
    });

    it('fails a run a stopped process left open before starting the next', async () => {
      const [interrupted] = await dbQuery<{ id: number }>(
        app,
        'INSERT INTO batch_job_run ("batchJobId", "startDate", "result") VALUES ($1, $2, $3) RETURNING id',
        [TEST_JOB_ID, new Date(Date.UTC(2020, 0, 1)), BatchJobRunResult.RUNNING]
      );

      await runAndAwaitRun();

      const [row] = await dbQuery<{ result: string; error: string | null; endDate: Date | null }>(
        app,
        'SELECT "result", "error", "endDate" FROM batch_job_run WHERE id = $1',
        [interrupted.id]
      );

      expect(row).toMatchObject({
        result: BatchJobRunResult.FAILED,
        error: 'Interrupted before its result was recorded',
      });
      expect(row.endDate).not.toBeNull();
    });

    it('keeps the last 10 succeeded runs and the history size of failed ones, and pages them newest first', async () => {
      for (let minute = 0; minute < HISTORY_SIZE + 5; minute++) {
        const startDate = new Date(Date.UTC(2020, 0, 1, 0, minute));

        await dbQuery(
          app,
          'INSERT INTO batch_job_run ("batchJobId", "startDate", "endDate", "result") VALUES ($1, $2, $3, $4), ($1, $5, $5, $6)',
          [
            TEST_JOB_ID,
            startDate,
            startDate,
            BatchJobRunResult.FAILED,
            new Date(Date.UTC(2021, 0, 1, 0, minute)),
            BatchJobRunResult.SUCCEEDED,
          ]
        );
      }

      const succeeded = await runAndAwaitRun();

      expect(await runCount(BatchJobRunResult.SUCCEEDED)).toBe(SUCCEEDED_HISTORY_SIZE);
      expect(await runCount(BatchJobRunResult.FAILED)).toBe(HISTORY_SIZE + 5);

      runner.failNextRun();
      const failed = await runAndAwaitRun();

      expect(await runCount(BatchJobRunResult.SUCCEEDED)).toBe(SUCCEEDED_HISTORY_SIZE);
      expect(await runCount(BatchJobRunResult.FAILED)).toBe(HISTORY_SIZE);

      const total = SUCCEEDED_HISTORY_SIZE + HISTORY_SIZE;
      const pages = Math.ceil(total / PAGE_SIZE);

      const firstPage = await getBatchJobRunList(app, token, TEST_JOB_ID, 1).expect(200);

      expect(firstPage.body.pages).toBe(pages);
      expect(firstPage.body.total).toBe(total);
      expect(firstPage.body.batchJobRunList.slice(0, 2).map((run: BatchJobRunDto) => run.id)).toEqual([
        failed.id,
        succeeded.id,
      ]);

      const lastPage: BatchJobRunDto[] = await listRuns(pages);

      expect(lastPage).toHaveLength(total - (pages - 1) * PAGE_SIZE);

      // 105 seeded failures plus the new one, so the six oldest go.
      expect(new Date(lastPage[lastPage.length - 1].startDate).toISOString()).toBe(
        new Date(Date.UTC(2020, 0, 1, 0, 6)).toISOString()
      );

      await updateBatchJobState(app, token, TEST_JOB_ID, { enabled: true }).expect(200);
    });

    it('rejects a page below one', async () => {
      await getBatchJobRunList(app, token, TEST_JOB_ID, 0).expect(400);
    });

    it('rejects a page that is not a number', async () => {
      await getBatchJobRunList(app, token, TEST_JOB_ID, 'abc').expect(400);
    });

    it('rejects a job id that does not exist', async () => {
      await getBatchJobRunList(app, token, 2147483647).expect(400);
    });
  });
});
