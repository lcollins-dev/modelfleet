import { Module } from '@nestjs/common';

import { DockerModule } from '../docker/docker.module';
import { ScanModule } from '../model/scan/scan.module';
import { InstanceEndpointService } from './instance-endpoint.service';
import { InstanceRuntimeService } from './instance-runtime.service';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [DockerModule, ScanModule],
  providers: [InstanceRuntimeService, ReadinessService, InstanceEndpointService],
  exports: [InstanceRuntimeService, InstanceEndpointService],
})
export class InstanceModule {}
