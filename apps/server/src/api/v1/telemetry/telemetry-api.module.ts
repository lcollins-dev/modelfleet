import { Module } from '@nestjs/common';

import { TelemetryAdminService } from './telemetry-admin.service';

import { FleetTelemetryAdminController } from './fleet-telemetry-admin.controller';
import { TelemetryAdminController } from './telemetry-admin.controller';

import { GpuModule } from '@/core/gpu/gpu.module';
import { InstanceModule } from '@/core/instance/instance.module';
import { LedgerModule } from '@/core/ledger/ledger.module';
import { NodeModule } from '@/core/node/node.module';
import { TelemetryModule } from '@/core/telemetry/telemetry.module';

@Module({
  imports: [GpuModule, InstanceModule, LedgerModule, NodeModule, TelemetryModule],
  providers: [TelemetryAdminService],
  controllers: [FleetTelemetryAdminController, TelemetryAdminController],
})
export class TelemetryApiModule {}
