import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { inspect } from 'node:util';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJobRun } from './entities/batch-job-run.entity';
import { BatchJob } from './entities/batch-job.entity';

import { ConfigService } from '@/config/config.service';

const BATCH_JOB_MISSING_MESSAGE = 'This batch job does not exist';
const BATCH_JOB_UNREGISTERED_MESSAGE = 'This batch job has not been registered';
const BATCH_JOB_RUNNING_MESSAGE = 'This batch job is already running';

const RUN_INTERRUPTED_MESSAGE = 'Interrupted before its result was recorded';
const RUN_NO_MESSAGE = 'Failed without a message';
const RUN_ERROR_MAX_LENGTH = 2000;

const SUCCEEDED_RUN_HISTORY_SIZE = 10;

export abstract class BatchJobRunner {
  abstract run(): Promise<void>;
}

@Injectable()
export class BatchJobService {
  private readonly logger = new Logger(BatchJobService.name);

  private readonly runners = new Map<BatchJobId, BatchJobRunner>();
  private readonly runningJobs = new Set<BatchJobId>();

  constructor(
    private schedulerRegistry: SchedulerRegistry,
    private readonly configService: ConfigService,
    @InjectRepository(BatchJob)
    private readonly batchJobRepository: Repository<BatchJob>,
    @InjectRepository(BatchJobRun)
    private readonly batchJobRunRepository: Repository<BatchJobRun>
  ) {}

  /** A null `cronExpression` registers the job unscheduled, so only `runNow` starts it. */
  async registerBatchJob(
    batchJobId: BatchJobId,
    cronExpression: string | null,
    batchJobRunner: BatchJobRunner
  ): Promise<void> {
    this.logger.log({ batchJobId }, 'registerBatchJob(): Attempting to register batch job');

    const batchJob = await this.getBatchJob(batchJobId);
    const cronJobName = `${batchJobId}`;

    if (this.runners.has(batchJobId) || this.schedulerRegistry.doesExist('cron', cronJobName)) {
      this.logger.error(
        { batchJobId, batchJobName: batchJob.name },
        'registerBatchJob(): Batch job has already been registered'
      );
      throw new InternalServerErrorException();
    }

    await this.batchJobRepository.update({ id: batchJobId }, { cronExpression });
    await this.failInterruptedRuns(batchJobId);

    this.runners.set(batchJobId, batchJobRunner);

    if (cronExpression === null) {
      return;
    }

    const cronJob = new CronJob(cronExpression, () => {
      if (this.runningJobs.has(batchJobId)) {
        this.logger.log(
          { batchJobId, batchJobName: batchJob.name },
          'runBatchJob(): Skipping batch job as it is already running'
        );
        return;
      }

      this.runExclusive(batchJobId, () => this.runIfEnabled(batchJobId, batchJobRunner)).catch((error: unknown) => {
        this.logger.error(
          { batchJobId, batchJobName: batchJob.name, error },
          'runBatchJob(): Batch job wrapper run failed'
        );
      });
    });

    this.schedulerRegistry.addCronJob(cronJobName, cronJob);
    cronJob.start();
  }

  /** Ordered by id. */
  findAll(): Promise<BatchJob[]> {
    return this.batchJobRepository.find({ order: { id: 'ASC' } });
  }

  async findWithThrow(batchJobId: BatchJobId): Promise<BatchJob> {
    const batchJob = await this.batchJobRepository.findOne({ where: { id: batchJobId } });

    if (!batchJob) {
      throw new BadRequestException(BATCH_JOB_MISSING_MESSAGE);
    }

    return batchJob;
  }

  /** A page of the retained runs, newest first. */
  async findAndCountRuns(batchJobId: BatchJobId, skip: number, take: number): Promise<[BatchJobRun[], number]> {
    await this.findWithThrow(batchJobId);

    return this.batchJobRunRepository.findAndCount({
      where: { batchJobId },
      order: { startDate: 'DESC', id: 'DESC' },
      skip,
      take,
    });
  }

  async setEnabled(batchJobId: BatchJobId, enabled: boolean): Promise<void> {
    await this.findWithThrow(batchJobId);

    await this.batchJobRepository.update({ id: batchJobId }, { enabled });
  }

  /**
   * Starts even a disabled or unscheduled job and answers its run as soon as it is recorded, while the job carries on.
   * A failure disables the job, as on a schedule.
   */
  async runNow(batchJobId: BatchJobId): Promise<BatchJobRun> {
    const batchJob = await this.findWithThrow(batchJobId);
    const batchJobRunner = this.runners.get(batchJobId);

    if (!batchJobRunner) {
      throw new BadRequestException(BATCH_JOB_UNREGISTERED_MESSAGE);
    }

    if (this.runningJobs.has(batchJobId)) {
      throw new BadRequestException(BATCH_JOB_RUNNING_MESSAGE);
    }

    this.runningJobs.add(batchJobId);

    const run = await this.startRun(batchJob).catch((error: unknown) => {
      this.runningJobs.delete(batchJobId);
      throw error;
    });

    this.completeRun(batchJob, batchJobRunner, run)
      .finally(() => {
        this.runningJobs.delete(batchJobId);
      })
      .catch((error: unknown) => {
        this.logger.error(
          { batchJobId, batchJobName: batchJob.name, error },
          'runNow(): Failed to record the batch job run'
        );
      });

    return run;
  }

  /** Call it in the same tick as the `runningJobs` check, so two runs of one job never overlap. */
  private runExclusive(batchJobId: BatchJobId, work: () => Promise<void>): Promise<void> {
    this.runningJobs.add(batchJobId);

    return work().finally(() => {
      this.runningJobs.delete(batchJobId);
    });
  }

  private async runIfEnabled(batchJobId: BatchJobId, batchJobRunner: BatchJobRunner): Promise<void> {
    const batchJob = await this.getBatchJob(batchJobId);

    if (!batchJob.enabled) {
      this.logger.error(
        { batchJobId, batchJobName: batchJob.name },
        'runIfEnabled(): Skipping batch job as it is currently disabled'
      );
      return;
    }

    const run = await this.startRun(batchJob);
    await this.completeRun(batchJob, batchJobRunner, run);
  }

  private async completeRun(batchJob: BatchJob, batchJobRunner: BatchJobRunner, run: BatchJobRun): Promise<void> {
    const batchJobId = batchJob.id;

    // A rejection handler, not a trailing catch, so a failed write in finishRun never counts as the job failing.
    const errorMessage = await batchJobRunner.run().then(
      () => {
        this.logger.log({ batchJobId, batchJobName: batchJob.name }, 'completeRun(): Batch job succeeded');
        return null;
      },
      (error: unknown) => {
        this.logger.log(
          { batchJobId, batchJobName: batchJob.name, error },
          'completeRun(): Batch job failed - disabling job'
        );
        return this.runErrorMessage(error);
      }
    );

    await this.finishRun(run, errorMessage);
  }

  @Transactional()
  private async startRun(batchJob: BatchJob): Promise<BatchJobRun> {
    const batchJobId = batchJob.id;

    this.logger.log({ batchJobId, batchJobName: batchJob.name }, 'startRun(): Running batch job');
    await this.failInterruptedRuns(batchJobId);

    const run = new BatchJobRun({ batchJobId, startDate: new Date() });

    await this.batchJobRunRepository.insert(run);
    await this.batchJobRepository.update({ id: batchJobId }, { lastStartDate: run.startDate });

    return run;
  }

  /** A non-null `errorMessage` disables the job. Either way, the job's runs with this run's result are pruned. */
  @Transactional()
  private async finishRun(run: BatchJobRun, errorMessage: string | null): Promise<void> {
    const endDate = new Date();
    const result = errorMessage === null ? BatchJobRunResult.SUCCEEDED : BatchJobRunResult.FAILED;

    await this.batchJobRunRepository.update({ id: run.id }, { endDate, result, error: errorMessage });

    if (errorMessage === null) {
      await this.batchJobRepository.update({ id: run.batchJobId }, { lastSuccessDate: endDate });
    } else {
      await this.batchJobRepository.update({ id: run.batchJobId }, { lastFailDate: endDate, enabled: false });
    }

    await this.pruneRuns(run.batchJobId, result);
  }

  /**
   * Call only while none of the job's runs is going, so every open run is one that never closed. Prunes the failed runs
   * once it fails any, as nothing else would for a job whose own runs never fail.
   */
  @Transactional()
  private async failInterruptedRuns(batchJobId: BatchJobId): Promise<void> {
    const endDate = new Date();

    const result = await this.batchJobRunRepository.update(
      { batchJobId, result: BatchJobRunResult.RUNNING },
      { endDate, result: BatchJobRunResult.FAILED, error: RUN_INTERRUPTED_MESSAGE }
    );

    if ((result.affected ?? 0) > 0) {
      this.logger.log({ batchJobId, runs: result.affected }, 'failInterruptedRuns(): Failed runs a restart cut off');
      await this.batchJobRepository.update({ id: batchJobId }, { lastFailDate: endDate });
      await this.pruneRuns(batchJobId, BatchJobRunResult.FAILED);
    }
  }

  private async pruneRuns(batchJobId: BatchJobId, result: BatchJobRunResult): Promise<void> {
    const historySize =
      result === BatchJobRunResult.SUCCEEDED ? SUCCEEDED_RUN_HISTORY_SIZE : this.configService.batchJobRunHistorySize;

    await this.batchJobRunRepository
      .createQueryBuilder()
      .delete()
      .where('"batchJobId" = :batchJobId AND "result" = :result', { batchJobId, result })
      .andWhere(
        `"id" NOT IN (
          SELECT "id" FROM "batch_job_run" WHERE "batchJobId" = :batchJobId AND "result" = :result
          ORDER BY "startDate" DESC, "id" DESC LIMIT :historySize
        )`,
        { historySize }
      )
      .execute();
  }

  private runErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : inspect(error);

    return (message === '' ? RUN_NO_MESSAGE : message).slice(0, RUN_ERROR_MAX_LENGTH);
  }

  private async getBatchJob(batchJobId: BatchJobId): Promise<BatchJob> {
    const batchJob = await this.batchJobRepository.findOne({ where: { id: batchJobId } });

    if (!batchJob) {
      this.logger.error({ batchJobId }, 'getBatchJob(): Failed to get batch job from DB');
      throw new InternalServerErrorException();
    }

    return batchJob;
  }
}
