import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BatchJobRun } from './entities/batch-job-run.entity';
import { BatchJob } from './entities/batch-job.entity';

import { BatchJobService } from './batch-job.service';

@Module({
  imports: [TypeOrmModule.forFeature([BatchJob, BatchJobRun]), ScheduleModule.forRoot()],
  providers: [BatchJobService],
  exports: [BatchJobService],
})
export class BatchJobModule {}
