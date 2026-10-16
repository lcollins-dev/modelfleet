import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Availability } from './entities/availability.entity';
import { Model } from './entities/model.entity';

import { ModelCatalogueService } from './model-catalogue.service';
import { ModelReferenceService } from './model-reference.service';
import { ModelService } from './model.service';

import { AgentModule } from '../agent/agent.module';
import { EventModule } from '../event/event.module';
import { NodeModule } from '../node/node.module';

import { ModelUsageRegistry } from './model-usage.registry';
import { ModelGateway } from './model.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([Model, Availability]), AgentModule, EventModule, NodeModule],
  providers: [ModelGateway, ModelService, ModelCatalogueService, ModelReferenceService, ModelUsageRegistry],
  exports: [ModelService, ModelCatalogueService, ModelReferenceService, ModelUsageRegistry],
})
export class ModelModule {}
