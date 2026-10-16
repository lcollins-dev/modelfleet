import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module';
import { DockerModule } from './docker/docker.module';
import { DownloadModule } from './download/download.module';
import { ModelModule } from './model/model.module';
import { ReconcileModule } from './reconcile/reconcile.module';
import { RelayModule } from './relay/relay.module';
import { ServerModule } from './server/server.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    ConfigModule,
    DockerModule,
    ServerModule,
    ReconcileModule,
    TelemetryModule,
    ModelModule,
    DownloadModule,
    RelayModule,
  ],
})
export class AppModule {}
