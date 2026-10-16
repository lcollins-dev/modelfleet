import { Module } from '@nestjs/common';

import { ModelAdminService } from './model-admin.service';

import { ModelAdminController } from './model-admin.controller';
import { NodeModelAdminController } from './node-model-admin.controller';

import { ModelModule } from '@/core/model/model.module';
import { NodeModule } from '@/core/node/node.module';

@Module({
  imports: [ModelModule, NodeModule],
  providers: [ModelAdminService],
  controllers: [ModelAdminController, NodeModelAdminController],
})
export class ModelApiModule {}
