import { Module } from '@nestjs/common';

import { TelemetryService } from './telemetry.service';

import { AgentModule } from '../agent/agent.module';

import { TelemetryGateway } from './telemetry.gateway';

@Module({
  imports: [AgentModule],
  providers: [TelemetryGateway, TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
