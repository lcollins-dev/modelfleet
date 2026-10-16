import { Module } from '@nestjs/common';

import { ModelController } from './model.controller';

import { DeploymentModule } from '@/core/deployment/deployment.module';

@Module({
  imports: [DeploymentModule],
  controllers: [ModelController],
})
export class ModelGatewayModule {}
