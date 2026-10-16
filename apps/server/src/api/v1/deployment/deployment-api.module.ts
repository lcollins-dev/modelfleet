import { Module } from '@nestjs/common';

import { DeploymentAdminService } from './deployment-admin.service';

import { DeploymentAdminController } from './deployment-admin.controller';

import { DeploymentModule } from '@/core/deployment/deployment.module';

@Module({
  imports: [DeploymentModule],
  providers: [DeploymentAdminService],
  controllers: [DeploymentAdminController],
})
export class DeploymentApiModule {}
