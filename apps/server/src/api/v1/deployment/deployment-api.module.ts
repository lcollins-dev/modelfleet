import { Module } from '@nestjs/common';

import { DeploymentAdminService } from './deployment-admin.service';

import { DeploymentAdminController } from './deployment-admin.controller';

import { DeploymentModule } from '@/core/deployment/deployment.module';
import { InstanceModule } from '@/core/instance/instance.module';

@Module({
  imports: [DeploymentModule, InstanceModule],
  providers: [DeploymentAdminService],
  controllers: [DeploymentAdminController],
})
export class DeploymentApiModule {}
