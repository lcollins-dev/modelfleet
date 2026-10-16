import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId, BatchJobRunResult } from '@libs/dto';

import { BatchJobRun } from '@/core/batch-job/entities/batch-job-run.entity';
import { BatchJob } from '@/core/batch-job/entities/batch-job.entity';

import { BatchJobAdminService } from '@/api/v1/batch-job/batch-job-admin.service';
import { ConfigService } from '@/config/config.service';
import { BatchJobService } from '@/core/batch-job/batch-job.service';

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

const PAGE_SIZE = 20;

const buildBatchJobRun = (id: number, startDate: string, overrides: Partial<BatchJobRun> = {}): BatchJobRun => {
  const batchJobRun = new BatchJobRun({ batchJobId: BatchJobId.RESIDENCY, startDate: new Date(startDate) });

  Object.assign(batchJobRun, { id, ...overrides });

  return batchJobRun;
};

describe('BatchJobAdminService', () => {
  let batchJobAdminService: BatchJobAdminService;
  let batchJobService: {
    findAll: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    findAndCountRuns: ReturnType<typeof vi.fn>;
    setEnabled: ReturnType<typeof vi.fn>;
    runNow: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    batchJobService = {
      findAll: vi.fn().mockResolvedValue([]),
      findWithThrow: vi.fn().mockResolvedValue(buildBatchJob()),
      findAndCountRuns: vi.fn().mockResolvedValue([[], 0]),
      setEnabled: vi.fn().mockResolvedValue(undefined),
      runNow: vi.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BatchJobAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        { provide: BatchJobService, useValue: batchJobService },
      ],
    }).compile();

    batchJobAdminService = moduleRef.get(BatchJobAdminService);
  });

  describe('getBatchJob', () => {
    it('throws when the batch job does not exist', async () => {
      batchJobService.findWithThrow.mockRejectedValue(new BadRequestException());

      await expect(batchJobAdminService.getBatchJob(BatchJobId.RESIDENCY)).rejects.toThrow(BadRequestException);
    });

    it('maps the entity onto the response', async () => {
      const lastStartDate = new Date('2026-05-15T12:00:00Z');
      batchJobService.findWithThrow.mockResolvedValue(
        buildBatchJob({ cronExpression: '0 * * * *', lastStartDate, enabled: false })
      );

      const batchJob = await batchJobAdminService.getBatchJob(BatchJobId.RESIDENCY);

      expect(batchJob).toEqual({
        id: BatchJobId.RESIDENCY,
        name: 'Residency',
        desc: 'Keeps deployments resident',
        cronExpression: '0 * * * *',
        enabled: false,
        lastStartDate,
        lastSuccessDate: null,
        lastFailDate: null,
      });
    });
  });

  describe('getBatchJobList', () => {
    it('maps every entity onto the response', async () => {
      batchJobService.findAll.mockResolvedValue([buildBatchJob(), buildBatchJob({ name: 'Second' })]);

      const response = await batchJobAdminService.getBatchJobList();

      expect(response.batchJobList).toHaveLength(2);
      expect(response.batchJobList[1].name).toBe('Second');
    });

    it('returns an empty list when there are no batch jobs', async () => {
      const response = await batchJobAdminService.getBatchJobList();

      expect(response).toEqual({ batchJobList: [] });
    });
  });

  describe('updateBatchJobState', () => {
    it('changes state through the domain', async () => {
      await batchJobAdminService.updateBatchJobState(BatchJobId.RESIDENCY, false);

      expect(batchJobService.setEnabled).toHaveBeenCalledWith(BatchJobId.RESIDENCY, false);
    });
  });

  describe('getBatchJobRunList', () => {
    it('reads each run down to what a caller needs, in the order the domain gives', async () => {
      const running = buildBatchJobRun(3, '2026-10-02T14:47:00Z');
      const failed = buildBatchJobRun(2, '2026-10-02T13:47:00Z', {
        endDate: new Date('2026-10-02T13:47:12Z'),
        result: BatchJobRunResult.FAILED,
        error: 'deadlock detected',
      });

      batchJobService.findAndCountRuns.mockResolvedValue([[running, failed], 2]);

      const response = await batchJobAdminService.getBatchJobRunList(BatchJobId.RESIDENCY, 1);

      expect(response.batchJobRunList).toEqual([
        {
          id: 3,
          startDate: new Date('2026-10-02T14:47:00Z'),
          endDate: null,
          result: BatchJobRunResult.RUNNING,
          error: null,
        },
        {
          id: 2,
          startDate: new Date('2026-10-02T13:47:00Z'),
          endDate: new Date('2026-10-02T13:47:12Z'),
          result: BatchJobRunResult.FAILED,
          error: 'deadlock detected',
        },
      ]);
    });

    it('reads the page asked for at the configured page size and counts the pages and runs', async () => {
      batchJobService.findAndCountRuns.mockResolvedValue([[], 45]);

      const response = await batchJobAdminService.getBatchJobRunList(BatchJobId.RESIDENCY, 3);

      expect(batchJobService.findAndCountRuns).toHaveBeenCalledWith(BatchJobId.RESIDENCY, 2 * PAGE_SIZE, PAGE_SIZE);
      expect(response.pages).toBe(3);
      expect(response.total).toBe(45);
    });
  });

  describe('runBatchJob', () => {
    it('answers the run the domain started', async () => {
      batchJobService.runNow.mockResolvedValue(buildBatchJobRun(7, '2026-10-02T14:47:00Z'));

      const response = await batchJobAdminService.runBatchJob(BatchJobId.RESIDENCY);

      expect(batchJobService.runNow).toHaveBeenCalledWith(BatchJobId.RESIDENCY);
      expect(response).toEqual({
        id: 7,
        startDate: new Date('2026-10-02T14:47:00Z'),
        endDate: null,
        result: BatchJobRunResult.RUNNING,
        error: null,
      });
    });
  });
});
