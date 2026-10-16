import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Instance } from './entities/instance.entity';
import { MeasuredVram } from './entities/measured-vram.entity';

import { ExpectedUsageService } from './expected-usage.service';
import { InstanceAdmissionService } from './instance-admission.service';
import { InstanceDesiredStateService } from './instance-desired-state.service';
import { InstanceLaunchService } from './instance-launch.service';
import { InstanceObservationService } from './instance-observation.service';
import { InstanceService } from './instance.service';
import { MeasuredVramService } from './measured-vram.service';

import { DeploymentModule } from '../deployment/deployment.module';
import { EventModule } from '../event/event.module';
import { GpuModule } from '../gpu/gpu.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ModelModule } from '../model/model.module';
import { NodeModule } from '../node/node.module';
import { TelemetryModule } from '../telemetry/telemetry.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Instance, MeasuredVram]),
    DeploymentModule,
    EventModule,
    GpuModule,
    LedgerModule,
    ModelModule,
    NodeModule,
    TelemetryModule,
  ],
  providers: [
    InstanceService,
    InstanceAdmissionService,
    ExpectedUsageService,
    MeasuredVramService,
    InstanceLaunchService,
    InstanceDesiredStateService,
    InstanceObservationService,
  ],
  exports: [InstanceService, InstanceAdmissionService, InstanceLaunchService],
})
export class InstanceModule {}
