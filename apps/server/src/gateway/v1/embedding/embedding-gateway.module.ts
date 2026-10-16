import { Module } from '@nestjs/common';

import { EmbeddingService } from './embedding.service';

import { EmbeddingController } from './embedding.controller';

import { ProxyModule } from '../../proxy/proxy.module';

@Module({
  imports: [ProxyModule],
  providers: [EmbeddingService],
  controllers: [EmbeddingController],
})
export class EmbeddingGatewayModule {}
