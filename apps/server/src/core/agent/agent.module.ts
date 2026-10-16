import { Module } from '@nestjs/common';

import { AgentConnectionService } from './agent-connection.service';
import { AgentSessionService } from './agent-session.service';
import { RelayClientService } from './relay-client.service';

import { NodeModule } from '../node/node.module';

import { AgentGateway } from './agent.gateway';
import { DesiredStatePublisher } from './desired-state.publisher';

@Module({
  imports: [NodeModule],
  providers: [AgentGateway, AgentSessionService, AgentConnectionService, DesiredStatePublisher, RelayClientService],
  exports: [AgentConnectionService, RelayClientService],
})
export class AgentModule {}
