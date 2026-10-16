import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Node } from './entities/node.entity';

import { NodeAgentService } from './node-agent.service';
import { NodeStateService } from './node-state.service';
import { NodeService } from './node.service';

import { EventModule } from '../event/event.module';

@Module({
  imports: [TypeOrmModule.forFeature([Node]), EventModule],
  providers: [NodeService, NodeAgentService, NodeStateService],
  exports: [NodeService, NodeAgentService, NodeStateService],
})
export class NodeModule {}
