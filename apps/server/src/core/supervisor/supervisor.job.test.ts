import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchJobId } from '@libs/dto';

import { ConfigService } from '@/config/config.service';
import { BatchJobService } from '@/core/batch-job/batch-job.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';

import { SupervisorJob } from './supervisor.job';

describe('SupervisorJob', () => {
  let batchJobService: { registerBatchJob: ReturnType<typeof vi.fn> };
  let deploymentSupervisorService: { pass: ReturnType<typeof vi.fn> };
  let supervisorJob: SupervisorJob;

  beforeEach(() => {
    batchJobService = { registerBatchJob: vi.fn().mockResolvedValue(undefined) };
    deploymentSupervisorService = { pass: vi.fn().mockResolvedValue(undefined) };

    supervisorJob = new SupervisorJob(
      { batchJobResidencyCron: '5 * * * * *' } as ConfigService,
      batchJobService as unknown as BatchJobService,
      deploymentSupervisorService as unknown as DeploymentSupervisorService
    );
  });

  it('registers itself as the residency batch job, on the schedule its setting names', async () => {
    await supervisorJob.onModuleInit();

    expect(batchJobService.registerBatchJob).toHaveBeenCalledWith(BatchJobId.RESIDENCY, '5 * * * * *', supervisorJob);
  });

  it('runs a pass on each tick', async () => {
    await supervisorJob.run();

    expect(deploymentSupervisorService.pass).toHaveBeenCalledOnce();
  });

  it('answers without raising when a pass fails, so the job is not turned off after one bad run', async () => {
    deploymentSupervisorService.pass.mockRejectedValue(new Error('the database went away'));

    await expect(supervisorJob.run()).resolves.toBeUndefined();
  });
});
