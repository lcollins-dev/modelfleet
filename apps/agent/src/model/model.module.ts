import { Module } from '@nestjs/common';

import { ServerModule } from '../server/server.module';
import { ModelController } from './model.controller';
import { ModelPublisher } from './model.publisher';
import { ModelService } from './model.service';
import { ScanModule } from './scan/scan.module';

@Module({
  imports: [ServerModule, ScanModule],
  controllers: [ModelController],
  providers: [ModelService, ModelPublisher],
  exports: [ModelService],
})
export class ModelModule {}
