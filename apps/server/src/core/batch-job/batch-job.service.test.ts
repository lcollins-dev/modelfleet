import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJobRun } from '@/core/batch-job/entities/batch-job-run.entity';
import { BatchJob } from '@/core/batch-job/entities/batch-job.entity';

import { ConfigService } from '@/config/config.service';
import { BatchJobRunner, BatchJobService } from '@/core/batch-job/batch-job.service';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const cronTicks: (() => void)[] = [];
const cronStart = vi.fn();

vi.mock('cron', () => ({
  CronJob: vi.fn(function (
    this: { cronExpression: string; start: () => void },
    expression: string,
    onTick: () => void
  ) {
    cronTicks.push(onTick);

    this.cronExpression = expression;
    this.start = cronStart;
  }),
}));

interface IRepositoryMock {
  find: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

interface IRunRepositoryMock {
  findAndCount: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  createQueryBuilder: ReturnType<typeof vi.fn>;
}

interface IPruneQueryMock {
  delete: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

const RUN_ID = 7;
const HISTORY_SIZE = 100;

const buildBatchJob = (overrides: Partial<BatchJob> = {}): BatchJob => {
  const batchJob = new BatchJob({
    id: BatchJobId.RESIDENCY,
    name: 'Residency',
    desc: 'Keeps deployments resident',
    enabled: true,
  });

  Object.assign(batchJob, overrides);

  return batchJob;
};

// The cron callback is fire-and-forget, so the assertions have to wait for its chain to settle.
const flushMicrotasks = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('BatchJobService', () => {
  let batchJobService: BatchJobService;
  let batchJobRepository: IRepositoryMock;
  let batchJobRunRepository: IRunRepositoryMock;
  let doesExistMock: ReturnType<typeof vi.fn>;
  let addCronJobMock: ReturnType<typeof vi.fn>;
  let runner: BatchJobRunner;
  let runMock: Mock<() => Promise<void>>;
  let pruneQuery: IPruneQueryMock;

  beforeEach(async () => {
    cronTicks.length = 0;
    vi.mocked(CronJob).mockClear();
    cronStart.mockClear();

    batchJobRepository = { find: vi.fn(), findOne: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };

    pruneQuery = {
      delete: vi.fn(() => pruneQuery),
      where: vi.fn(() => pruneQuery),
      andWhere: vi.fn(() => pruneQuery),
      execute: vi.fn().mockResolvedValue({ affected: 0 }),
    };
    batchJobRunRepository = {
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      insert: vi.fn((run: BatchJobRun) => {
        run.id = RUN_ID;
        return Promise.resolve(undefined);
      }),
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: vi.fn().mockReturnValue(pruneQuery),
    };
    doesExistMock = vi.fn().mockReturnValue(false);
    addCronJobMock = vi.fn();
    runMock = vi.fn().mockResolvedValue(undefined);
    runner = { run: runMock };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BatchJobService,
        {
          provide: SchedulerRegistry,
          useValue: { doesExist: doesExistMock, addCronJob: addCronJobMock },
        },
        { provide: ConfigService, useValue: { batchJobRunHistorySize: HISTORY_SIZE } },
        { provide: getRepositoryToken(BatchJob), useValue: batchJobRepository },
        { provide: getRepositoryToken(BatchJobRun), useValue: batchJobRunRepository },
      ],
    }).compile();

    batchJobService = moduleRef.get(BatchJobService);
  });

  describe('registerBatchJob', () => {
    it('throws when the batch job is missing from the database', async () => {
      batchJobRepository.findOne.mockResolvedValue(null);

      await expect(batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '* * * * *', runner)).rejects.toThrow(
        InternalServerErrorException
      );

      expect(addCronJobMock).not.toHaveBeenCalled();
    });

    it('throws when a cron job is already registered under the same name', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());
      doesExistMock.mockReturnValue(true);

      await expect(batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '* * * * *', runner)).rejects.toThrow(
        InternalServerErrorException
      );

      expect(addCronJobMock).not.toHaveBeenCalled();
    });

    it('stores the cron expression against the batch job', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '0 * * * *', runner);

      expect(batchJobRepository.update).toHaveBeenCalledWith(
        { id: BatchJobId.RESIDENCY },
        { cronExpression: '0 * * * *' }
      );
    });

    it('fails the runs a stopped process left open and records the failure against the job', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());
      batchJobRunRepository.update.mockResolvedValue({ affected: 1 });

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '0 * * * *', runner);

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { batchJobId: BatchJobId.RESIDENCY, result: BatchJobRunResult.RUNNING },
        {
          endDate: expect.any(Date) as Date,
          result: BatchJobRunResult.FAILED,
          error: 'Interrupted before its result was recorded',
        }
      );
      expect(batchJobRepository.update).toHaveBeenCalledWith(
        { id: BatchJobId.RESIDENCY },
        { lastFailDate: expect.any(Date) as Date }
      );
    });

    it('leaves the last failure alone when no run was left open', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '0 * * * *', runner);

      expect(batchJobRepository.update).not.toHaveBeenCalledWith(expect.anything(), {
        lastFailDate: expect.any(Date) as Date,
      });
      expect(pruneQuery.execute).not.toHaveBeenCalled();
    });

    it('prunes the failed runs once it fails a run left open, as a job whose runs never fail adds no other', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());
      batchJobRunRepository.update.mockResolvedValue({ affected: 1 });

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '0 * * * *', runner);

      expect(pruneQuery.where).toHaveBeenCalledWith(expect.any(String), {
        batchJobId: BatchJobId.RESIDENCY,
        result: BatchJobRunResult.FAILED,
      });
      expect(pruneQuery.andWhere).toHaveBeenCalledWith(expect.any(String), { historySize: HISTORY_SIZE });
    });

    it('throws when the batch job is already registered without a schedule', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, null, runner);

      await expect(batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '* * * * *', runner)).rejects.toThrow(
        InternalServerErrorException
      );

      expect(addCronJobMock).not.toHaveBeenCalled();
    });

    it('registers a job with no schedule without a cron job', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, null, runner);

      expect(batchJobRepository.update).toHaveBeenCalledWith({ id: BatchJobId.RESIDENCY }, { cronExpression: null });
      expect(addCronJobMock).not.toHaveBeenCalled();
      expect(CronJob).not.toHaveBeenCalled();
    });

    it('registers the cron job under the batch job id and starts it', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '0 * * * *', runner);

      expect(addCronJobMock).toHaveBeenCalledWith(`${BatchJobId.RESIDENCY}`, expect.anything());
      expect(cronStart).toHaveBeenCalled();
    });
  });

  describe('the registered cron callback', () => {
    beforeEach(async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '* * * * *', runner);

      batchJobRepository.update.mockClear();
      batchJobRunRepository.update.mockClear();
    });

    it('skips the run when the batch job is disabled, recording nothing', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob({ enabled: false }));

      cronTicks[0]();
      await flushMicrotasks();

      expect(runMock).not.toHaveBeenCalled();
      expect(batchJobRunRepository.insert).not.toHaveBeenCalled();
      expect(batchJobRepository.update).not.toHaveBeenCalled();
    });

    it('opens a running run and records its start against the job', async () => {
      cronTicks[0]();
      await flushMicrotasks();

      const run = batchJobRunRepository.insert.mock.calls[0][0] as BatchJobRun;

      expect(run).toMatchObject({
        batchJobId: BatchJobId.RESIDENCY,
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });
      expect(batchJobRepository.update).toHaveBeenNthCalledWith(
        1,
        { id: BatchJobId.RESIDENCY },
        { lastStartDate: run.startDate }
      );
    });

    it('closes the run as succeeded and records the success against the job', async () => {
      cronTicks[0]();
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalled();
      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        { endDate: expect.any(Date) as Date, result: BatchJobRunResult.SUCCEEDED, error: null }
      );
      expect(batchJobRepository.update).toHaveBeenNthCalledWith(
        2,
        { id: BatchJobId.RESIDENCY },
        { lastSuccessDate: expect.any(Date) as Date }
      );
    });

    it('closes the run as failed with its message and disables the batch job when the run rejects', async () => {
      runMock.mockRejectedValue(new Error('runner blew up'));

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        { endDate: expect.any(Date) as Date, result: BatchJobRunResult.FAILED, error: 'runner blew up' }
      );
      expect(batchJobRepository.update).toHaveBeenNthCalledWith(
        2,
        { id: BatchJobId.RESIDENCY },
        { lastFailDate: expect.any(Date) as Date, enabled: false }
      );
    });

    it('records a rejection that is not an Error as its text', async () => {
      runMock.mockRejectedValue('disk full');

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        expect.objectContaining({ error: 'disk full' })
      );
    });

    it('records a rejection with null as a failure', async () => {
      runMock.mockRejectedValue(null);

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        expect.objectContaining({ result: BatchJobRunResult.FAILED, error: 'null' })
      );
    });

    it('gives an error with an empty message one to show', async () => {
      runMock.mockRejectedValue(new Error(''));

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        expect.objectContaining({ error: 'Failed without a message' })
      );
    });

    it('leaves a successful job enabled when closing its run fails', async () => {
      batchJobRunRepository.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockRejectedValueOnce(new Error('deadlock detected'));

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledTimes(2);
      expect(batchJobRepository.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ enabled: false })
      );
    });

    it('records a rejection with a plain object as its contents', async () => {
      runMock.mockRejectedValue({ code: '40P01' });

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        expect.objectContaining({ error: "{ code: '40P01' }" })
      );
    });

    it('fails a run a previous tick left open before opening the next', async () => {
      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenNthCalledWith(
        1,
        { batchJobId: BatchJobId.RESIDENCY, result: BatchJobRunResult.RUNNING },
        expect.objectContaining({ result: BatchJobRunResult.FAILED })
      );
      expect(batchJobRunRepository.update.mock.invocationCallOrder[0]).toBeLessThan(
        batchJobRunRepository.insert.mock.invocationCallOrder[0]
      );
    });

    it("prunes the job's succeeded runs past the last 10 once a run succeeds", async () => {
      cronTicks[0]();
      await flushMicrotasks();

      expect(pruneQuery.execute).toHaveBeenCalledOnce();
      expect(pruneQuery.where).toHaveBeenCalledWith(expect.any(String), {
        batchJobId: BatchJobId.RESIDENCY,
        result: BatchJobRunResult.SUCCEEDED,
      });
      expect(pruneQuery.andWhere).toHaveBeenCalledWith(expect.any(String), { historySize: 10 });
    });

    it("prunes the job's failed runs past the history size once a run fails", async () => {
      runMock.mockRejectedValue(new Error('runner blew up'));

      cronTicks[0]();
      await flushMicrotasks();

      expect(pruneQuery.execute).toHaveBeenCalledOnce();
      expect(pruneQuery.where).toHaveBeenCalledWith(expect.any(String), {
        batchJobId: BatchJobId.RESIDENCY,
        result: BatchJobRunResult.FAILED,
      });
      expect(pruneQuery.andWhere).toHaveBeenCalledWith(expect.any(String), { historySize: HISTORY_SIZE });
    });

    it('prunes after the run is closed, in the same transaction', async () => {
      cronTicks[0]();
      await flushMicrotasks();

      const closeOrder = batchJobRunRepository.update.mock.invocationCallOrder.at(-1) ?? Infinity;

      expect(pruneQuery.execute.mock.invocationCallOrder[0]).toBeGreaterThan(closeOrder);
    });

    it('caps a long error message at 2,000 characters', async () => {
      runMock.mockRejectedValue(new Error('x'.repeat(5000)));

      cronTicks[0]();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        expect.objectContaining({ error: 'x'.repeat(2000) })
      );
    });

    it('skips a tick that arrives while the previous run is still going', async () => {
      let releaseRun: () => void = () => undefined;
      runMock.mockReturnValue(
        new Promise<void>(resolve => {
          releaseRun = resolve;
        })
      );

      cronTicks[0]();
      await flushMicrotasks();

      cronTicks[0]();
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(1);
      expect(batchJobRunRepository.insert).toHaveBeenCalledTimes(1);

      releaseRun();
      await flushMicrotasks();
    });

    it('accepts a later tick once the previous run has finished', async () => {
      cronTicks[0]();
      await flushMicrotasks();

      cronTicks[0]();
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('findAll', () => {
    it('orders the jobs by id', async () => {
      batchJobRepository.find.mockResolvedValue([]);

      await batchJobService.findAll();

      expect(batchJobRepository.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
    });
  });

  describe('findWithThrow', () => {
    it('throws when the batch job does not exist', async () => {
      batchJobRepository.findOne.mockResolvedValue(null);

      await expect(batchJobService.findWithThrow(BatchJobId.RESIDENCY)).rejects.toThrow(BadRequestException);
    });

    it('returns the row it found', async () => {
      const batchJob = buildBatchJob();
      batchJobRepository.findOne.mockResolvedValue(batchJob);

      await expect(batchJobService.findWithThrow(BatchJobId.RESIDENCY)).resolves.toBe(batchJob);
    });
  });

  describe('findAndCountRuns', () => {
    it('rejects an unknown batch job', async () => {
      batchJobRepository.findOne.mockResolvedValue(null);

      await expect(batchJobService.findAndCountRuns(BatchJobId.RESIDENCY, 0, 20)).rejects.toThrow(BadRequestException);

      expect(batchJobRunRepository.findAndCount).not.toHaveBeenCalled();
    });

    it("reads a page of the job's runs, newest first", async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.findAndCountRuns(BatchJobId.RESIDENCY, 20, 20);

      expect(batchJobRunRepository.findAndCount).toHaveBeenCalledWith({
        where: { batchJobId: BatchJobId.RESIDENCY },
        order: { startDate: 'DESC', id: 'DESC' },
        skip: 20,
        take: 20,
      });
    });
  });

  describe('setEnabled', () => {
    it('rejects an unknown batch job before updating', async () => {
      batchJobRepository.findOne.mockResolvedValue(null);

      await expect(batchJobService.setEnabled(BatchJobId.RESIDENCY, false)).rejects.toThrow(BadRequestException);

      expect(batchJobRepository.update).not.toHaveBeenCalled();
    });

    it('stores the new enabled flag', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.setEnabled(BatchJobId.RESIDENCY, false);

      expect(batchJobRepository.update).toHaveBeenCalledWith({ id: BatchJobId.RESIDENCY }, { enabled: false });
    });
  });

  describe('runNow', () => {
    const registerJob = async (): Promise<void> => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, '* * * * *', runner);
    };

    const holdRun = (): (() => void) => {
      let releaseRun: () => void = () => undefined;
      runMock.mockReturnValueOnce(
        new Promise<void>(resolve => {
          releaseRun = resolve;
        })
      );

      return () => releaseRun();
    };

    it('rejects an unknown batch job', async () => {
      batchJobRepository.findOne.mockResolvedValue(null);

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow(BadRequestException);

      expect(runMock).not.toHaveBeenCalled();
    });

    it('rejects a batch job that has not been registered', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob());

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow(
        'This batch job has not been registered'
      );

      expect(runMock).not.toHaveBeenCalled();
    });

    it('answers the run as running without waiting for the job, then closes it as succeeded', async () => {
      await registerJob();
      const releaseRun = holdRun();

      const run = await batchJobService.runNow(BatchJobId.RESIDENCY);

      expect(run).toMatchObject({
        id: RUN_ID,
        batchJobId: BatchJobId.RESIDENCY,
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });
      expect(batchJobRunRepository.update).not.toHaveBeenCalledWith({ id: RUN_ID }, expect.anything());

      releaseRun();
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        { endDate: expect.any(Date) as Date, result: BatchJobRunResult.SUCCEEDED, error: null }
      );
    });

    it('closes a failed run with its message, disabling the job', async () => {
      await registerJob();
      runMock.mockRejectedValue(new Error('runner blew up'));

      await batchJobService.runNow(BatchJobId.RESIDENCY);
      await flushMicrotasks();

      expect(batchJobRunRepository.update).toHaveBeenCalledWith(
        { id: RUN_ID },
        { endDate: expect.any(Date) as Date, result: BatchJobRunResult.FAILED, error: 'runner blew up' }
      );
      expect(batchJobRepository.update).toHaveBeenCalledWith(
        { id: BatchJobId.RESIDENCY },
        { lastFailDate: expect.any(Date) as Date, enabled: false }
      );
    });

    it('runs a disabled job, which its schedule would skip', async () => {
      await registerJob();
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob({ enabled: false }));

      await batchJobService.runNow(BatchJobId.RESIDENCY);
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(1);
    });

    it('runs a job registered without a schedule, and refuses a second run while it goes', async () => {
      batchJobRepository.findOne.mockResolvedValue(buildBatchJob({ cronExpression: null }));
      await batchJobService.registerBatchJob(BatchJobId.RESIDENCY, null, runner);
      const releaseRun = holdRun();

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).resolves.toMatchObject({
        result: BatchJobRunResult.RUNNING,
      });
      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow('This batch job is already running');

      releaseRun();
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(1);
    });

    it('refuses while a scheduled run is still going', async () => {
      await registerJob();
      const releaseRun = holdRun();

      cronTicks[0]();
      await flushMicrotasks();

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow('This batch job is already running');
      expect(runMock).toHaveBeenCalledTimes(1);

      releaseRun();
      await flushMicrotasks();
    });

    it('refuses a second run while the first is still going, and accepts one after', async () => {
      await registerJob();
      const releaseRun = holdRun();

      await batchJobService.runNow(BatchJobId.RESIDENCY);

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow('This batch job is already running');

      releaseRun();
      await flushMicrotasks();

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).resolves.toMatchObject({
        result: BatchJobRunResult.RUNNING,
      });
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(2);
    });

    it('skips a scheduled tick that arrives while it runs', async () => {
      await registerJob();
      const releaseRun = holdRun();

      await batchJobService.runNow(BatchJobId.RESIDENCY);

      cronTicks[0]();
      await flushMicrotasks();

      expect(runMock).toHaveBeenCalledTimes(1);

      releaseRun();
      await flushMicrotasks();
    });

    it('frees the job for the next run when the run cannot be recorded', async () => {
      await registerJob();
      batchJobRunRepository.insert.mockRejectedValueOnce(new Error('deadlock detected'));

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).rejects.toThrow('deadlock detected');

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).resolves.toMatchObject({
        result: BatchJobRunResult.RUNNING,
      });
    });

    it('frees the job for the next run when closing the run fails', async () => {
      await registerJob();
      batchJobRunRepository.update
        .mockResolvedValueOnce({ affected: 0 })
        .mockRejectedValueOnce(new Error('deadlock detected'));

      await batchJobService.runNow(BatchJobId.RESIDENCY);
      await flushMicrotasks();

      await expect(batchJobService.runNow(BatchJobId.RESIDENCY)).resolves.toMatchObject({
        result: BatchJobRunResult.RUNNING,
      });
    });
  });
});
