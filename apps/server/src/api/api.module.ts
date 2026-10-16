import { Module } from '@nestjs/common';

import { ApiKeyApiModule } from './v1/api-key/api-key-api.module';
import { AvailabilityApiModule } from './v1/availability/availability-api.module';
import { BatchJobApiModule } from './v1/batch-job/batch-job-api.module';
import { DeploymentApiModule } from './v1/deployment/deployment-api.module';
import { DownloadApiModule } from './v1/download/download-api.module';
import { EventApiModule } from './v1/event/event-api.module';
import { InstanceApiModule } from './v1/instance/instance-api.module';
import { ModelApiModule } from './v1/model/model-api.module';
import { NodeApiModule } from './v1/node/node-api.module';
import { NotificationApiModule } from './v1/notification/notification-api.module';
import { PresetApiModule } from './v1/preset/preset-api.module';
import { TelemetryApiModule } from './v1/telemetry/telemetry-api.module';
import { UserApiModule } from './v1/user/user-api.module';
import { VersionApiModule } from './v1/version/version-api.module';

@Module({
  imports: [
    AvailabilityApiModule,
    VersionApiModule,
    UserApiModule,
    BatchJobApiModule,
    NotificationApiModule,
    EventApiModule,
    NodeApiModule,
    ModelApiModule,
    PresetApiModule,
    DeploymentApiModule,
    InstanceApiModule,
    TelemetryApiModule,
    ApiKeyApiModule,
    DownloadApiModule,
  ],
})
export class ApiModule {}
