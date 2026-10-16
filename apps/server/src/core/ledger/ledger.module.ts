import { Module } from '@nestjs/common';

import { VramLedgerService } from './vram-ledger.service';

import { AgentModule } from '../agent/agent.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { GpuModule } from '../gpu/gpu.module';
import { NodeModule } from '../node/node.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [AgentModule, DeploymentModule, GpuModule, NodeModule, TelemetryModule],
  providers: [VramLedgerService],
  exports: [VramLedgerService],
})
export class LedgerModule {}
