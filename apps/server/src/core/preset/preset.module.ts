import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Preset } from './entities/preset.entity';

import { PresetService } from './preset.service';

import { ConfigurationModule } from '../configuration/configuration.module';
import { EventModule } from '../event/event.module';
import { ModelModule } from '../model/model.module';

import { PresetReferenceRegistry } from './preset-reference.registry';

@Module({
  imports: [TypeOrmModule.forFeature([Preset]), ConfigurationModule, EventModule, ModelModule],
  providers: [PresetService, PresetReferenceRegistry],
  exports: [PresetService, PresetReferenceRegistry],
})
export class PresetModule {}
