import { Module } from '@nestjs/common';

import { BatchJobAdminService } from './batch-job-admin.service';

import { BatchJobAdminController } from './batch-job-admin.controller';

import { BatchJobModule } from '@/core/batch-job/batch-job.module';

@Module({
  imports: [BatchJobModule],
  providers: [BatchJobAdminService],
  controllers: [BatchJobAdminController],
})
export class BatchJobApiModule {}
