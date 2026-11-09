import { Module } from '@nestjs/common';

import { DeploymentActionsService } from './deployment-actions.service';
import { DeploymentSupervisorService } from './deployment-supervisor.service';
import { EvictionPlannerService } from './eviction-planner.service';
import { InstanceEvictionService } from './instance-eviction.service';
import { InstanceLeaseService } from './instance-lease.service';
import { SupervisorPolicyService } from './supervisor-policy.service';

import { AgentModule } from '../agent/agent.module';
import { BatchJobModule } from '../batch-job/batch-job.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { EventModule } from '../event/event.module';
import { InstanceModule } from '../instance/instance.module';
import { LedgerModule } from '../ledger/ledger.module';
import { NodeModule } from '../node/node.module';

import { SupervisorJob } from './supervisor.job';

@Module({
  imports: [AgentModule, BatchJobModule, DeploymentModule, EventModule, InstanceModule, LedgerModule, NodeModule],
  providers: [
    DeploymentSupervisorService,
    DeploymentActionsService,
    EvictionPlannerService,
    InstanceEvictionService,
    InstanceLeaseService,
    SupervisorPolicyService,
    SupervisorJob,
  ],
  exports: [DeploymentSupervisorService, SupervisorPolicyService],
})
export class SupervisorModule {}
