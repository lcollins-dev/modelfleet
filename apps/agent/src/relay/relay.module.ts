import { Module } from '@nestjs/common';

import { DockerModule } from '../docker/docker.module';
import { InstanceModule } from '../instance/instance.module';
import { InferenceRelayService } from './inference/inference-relay.service';
import { LogsRelayService } from './logs/logs-relay.service';
import { RelayTokenService } from './relay-token.service';
import { RelayService } from './relay.service';

@Module({
  imports: [DockerModule, InstanceModule],
  providers: [RelayService, InferenceRelayService, LogsRelayService, RelayTokenService],
  exports: [RelayTokenService],
})
export class RelayModule {}
