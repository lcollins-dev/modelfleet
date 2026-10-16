import { Module } from '@nestjs/common';

import { DeploymentResolverService } from './deployment-resolver.service';
import { InferenceMetricsService } from './inference-metrics.service';

import { DeploymentModule } from '../deployment/deployment.module';
import { ModelModule } from '../model/model.module';

@Module({
  imports: [DeploymentModule, ModelModule],
  providers: [DeploymentResolverService, InferenceMetricsService],
  exports: [DeploymentResolverService, InferenceMetricsService],
})
export class InferenceModule {}
