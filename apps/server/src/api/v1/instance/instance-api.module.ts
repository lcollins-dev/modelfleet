import { Module } from '@nestjs/common';

import { InstanceAdminService } from './instance-admin.service';
import { InstanceOutputAdminService } from './instance-output-admin.service';

import { DeploymentInstanceAdminController } from './deployment-instance-admin.controller';
import { InstanceAdminController } from './instance-admin.controller';
import { NodeInstanceAdminController } from './node-instance-admin.controller';

import { AgentModule } from '@/core/agent/agent.module';
import { DeploymentModule } from '@/core/deployment/deployment.module';
import { EventModule } from '@/core/event/event.module';
import { GpuModule } from '@/core/gpu/gpu.module';
import { InstanceModule } from '@/core/instance/instance.module';
import { NodeModule } from '@/core/node/node.module';
import { SupervisorModule } from '@/core/supervisor/supervisor.module';
import { TelemetryModule } from '@/core/telemetry/telemetry.module';

@Module({
  imports: [
    AgentModule,
    DeploymentModule,
    EventModule,
    GpuModule,
    InstanceModule,
    NodeModule,
    SupervisorModule,
    TelemetryModule,
  ],
  providers: [InstanceAdminService, InstanceOutputAdminService],
  controllers: [DeploymentInstanceAdminController, InstanceAdminController, NodeInstanceAdminController],
})
export class InstanceApiModule {}
