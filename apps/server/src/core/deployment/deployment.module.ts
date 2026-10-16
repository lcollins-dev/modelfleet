import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Deployment } from './entities/deployment.entity';

import { DeploymentService } from './deployment.service';

import { ConfigurationModule } from '../configuration/configuration.module';
import { EventModule } from '../event/event.module';
import { ModelModule } from '../model/model.module';
import { PresetModule } from '../preset/preset.module';

@Module({
  imports: [TypeOrmModule.forFeature([Deployment]), ConfigurationModule, EventModule, ModelModule, PresetModule],
  providers: [DeploymentService],
  exports: [DeploymentService],
})
export class DeploymentModule {}
