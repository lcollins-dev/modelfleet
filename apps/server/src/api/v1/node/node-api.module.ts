import { Module } from '@nestjs/common';

import { NodeAdminService } from './node-admin.service';

import { NodeAdminController } from './node-admin.controller';

import { NodeModule } from '@/core/node/node.module';

@Module({
  imports: [NodeModule],
  providers: [NodeAdminService],
  controllers: [NodeAdminController],
})
export class NodeApiModule {}
