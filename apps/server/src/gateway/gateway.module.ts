import { Module } from '@nestjs/common';

import { GatewayListenerService } from './gateway-listener.service';

import { AudioGatewayModule } from './v1/audio/audio-gateway.module';
import { ChatGatewayModule } from './v1/chat/chat-gateway.module';
import { EmbeddingGatewayModule } from './v1/embedding/embedding-gateway.module';
import { ModelGatewayModule } from './v1/model/model-gateway.module';

@Module({
  imports: [ModelGatewayModule, ChatGatewayModule, EmbeddingGatewayModule, AudioGatewayModule],
  providers: [GatewayListenerService],
})
export class GatewayModule {}
