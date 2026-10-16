import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';

import { ConfigService } from './config/config.service';

import { ApiModule } from './api/api.module';
import { ConfigModule } from './config/config.module';
import { AgentModule } from './core/agent/agent.module';
import { ApiKeyModule } from './core/api-key/api-key.module';
import { DeploymentModule } from './core/deployment/deployment.module';
import { DownloadModule } from './core/download/download.module';
import { GpuModule } from './core/gpu/gpu.module';
import { InstanceModule } from './core/instance/instance.module';
import { ModelModule } from './core/model/model.module';
import { PresetModule } from './core/preset/preset.module';
import { SupervisorModule } from './core/supervisor/supervisor.module';
import { TelemetryModule } from './core/telemetry/telemetry.module';
import { DatabaseModule } from './database/database.module';
import { EmailModule } from './email/email.module';
import { EntryPointModule } from './entry-point/entry-point.module';
import { GatewayModule } from './gateway/gateway.module';
import { LoggerModule } from './logger/logger.module';

// serve-static tests `path + '/'`, so this covers `/api` and `/v1` too.
const WEB_EXCLUDED_PATHS = ['/api/{*path}', '/v1/{*path}'];

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    EmailModule,
    ApiModule,
    GatewayModule,
    EntryPointModule,
    AgentModule,
    ApiKeyModule,
    GpuModule,
    ModelModule,
    PresetModule,
    DeploymentModule,
    InstanceModule,
    SupervisorModule,
    TelemetryModule,
    DownloadModule,
    ServeStaticModule.forRootAsync({
      useFactory: (configService: ConfigService) =>
        configService.webRootPath === ''
          ? []
          : [
              {
                rootPath: configService.webRootPath,
                exclude: WEB_EXCLUDED_PATHS,
              },
            ],
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
