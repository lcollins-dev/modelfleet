import { Module } from '@nestjs/common';

import { PresetAdminService } from './preset-admin.service';

import { PresetAdminController } from './preset-admin.controller';

import { DeploymentModule } from '@/core/deployment/deployment.module';
import { PresetModule } from '@/core/preset/preset.module';

@Module({
  imports: [DeploymentModule, PresetModule],
  providers: [PresetAdminService],
  controllers: [PresetAdminController],
})
export class PresetApiModule {}
