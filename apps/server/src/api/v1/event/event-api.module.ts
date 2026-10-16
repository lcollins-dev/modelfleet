import { Module } from '@nestjs/common';

import { EventAdminService } from './event-admin.service';

import { EventAdminController } from './event-admin.controller';

import { ApiKeyModule } from '@/core/api-key/api-key.module';
import { DeploymentModule } from '@/core/deployment/deployment.module';
import { DownloadModule } from '@/core/download/download.module';
import { EventModule } from '@/core/event/event.module';
import { ModelModule } from '@/core/model/model.module';
import { NodeModule } from '@/core/node/node.module';
import { PresetModule } from '@/core/preset/preset.module';
import { UserModule } from '@/core/user/user.module';

@Module({
  imports: [
    ApiKeyModule,
    DeploymentModule,
    DownloadModule,
    EventModule,
    ModelModule,
    NodeModule,
    PresetModule,
    UserModule,
  ],
  providers: [EventAdminService],
  controllers: [EventAdminController],
})
export class EventApiModule {}
