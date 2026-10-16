import { Module } from '@nestjs/common';

import { DockerModule } from '../docker/docker.module';
import { ServerModule } from '../server/server.module';
import { DeviceReaderModule } from './device-reader/device-reader.module';
import { HostResourcesService } from './host-resources.service';
import { TelemetryPublisher } from './telemetry.publisher';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [DockerModule, ServerModule, DeviceReaderModule],
  providers: [HostResourcesService, TelemetryService, TelemetryPublisher],
  exports: [TelemetryService],
})
export class TelemetryModule {}
