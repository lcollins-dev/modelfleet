import { Module } from '@nestjs/common';

import { DeploymentActionsService } from './deployment-actions.service';
import { DeploymentSupervisorService } from './deployment-supervisor.service';
import { InstanceLeaseService } from './instance-lease.service';
import { SupervisorPolicyService } from './supervisor-policy.service';

import { AgentModule } from '../agent/agent.module';
import { BatchJobModule } from '../batch-job/batch-job.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { EventModule } from '../event/event.module';
import { InstanceModule } from '../instance/instance.module';
import { NodeModule } from '../node/node.module';

import { SupervisorJob } from './supervisor.job';

@Module({
  imports: [AgentModule, BatchJobModule, DeploymentModule, EventModule, InstanceModule, NodeModule],
  providers: [
    DeploymentSupervisorService,
    DeploymentActionsService,
    InstanceLeaseService,
    SupervisorPolicyService,
    SupervisorJob,
  ],
  exports: [DeploymentSupervisorService, SupervisorPolicyService],
})
export class SupervisorModule {}
