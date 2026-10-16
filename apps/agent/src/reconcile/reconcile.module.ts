import { Module } from '@nestjs/common';

import { InstanceModule } from '../instance/instance.module';
import { ServerModule } from '../server/server.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { ObservedStatePublisher } from './observed-state.publisher';
import { ReconcileController } from './reconcile.controller';
import { ReconcilerService } from './reconciler.service';

@Module({
  imports: [InstanceModule, ServerModule, TelemetryModule],
  controllers: [ReconcileController],
  providers: [ReconcilerService, ObservedStatePublisher],
  exports: [ReconcilerService],
})
export class ReconcileModule {}
