import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BatchJobId } from '@libs/dto';

import { BatchJobRunner, BatchJobService } from '../batch-job/batch-job.service';
import { DeploymentSupervisorService } from './deployment-supervisor.service';
import { ConfigService } from '@/config/config.service';

@Injectable()
export class SupervisorJob extends BatchJobRunner implements OnModuleInit {
  private readonly logger = new Logger(SupervisorJob.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly batchJobService: BatchJobService,
    private readonly deploymentSupervisorService: DeploymentSupervisorService
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.batchJobService.registerBatchJob(BatchJobId.RESIDENCY, this.configService.batchJobResidencyCron, this);
  }

  /**
   * Answers without raising, since a run that fails is a run the batch job turns itself off after, and a fleet that
   * stops being kept resident until someone notices a switch is worse than a pass that failed and is tried again.
   */
  run(): Promise<void> {
    return this.deploymentSupervisorService.pass().catch((error: unknown) => {
      this.logger.error({ error }, 'run(): A supervisor pass failed');
    });
  }
}
