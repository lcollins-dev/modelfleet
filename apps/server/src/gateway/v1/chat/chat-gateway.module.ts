import { Module } from '@nestjs/common';

import { ChatService } from './chat.service';

import { ChatController } from './chat.controller';

import { ProxyModule } from '../../proxy/proxy.module';

@Module({
  imports: [ProxyModule],
  providers: [ChatService],
  controllers: [ChatController],
})
export class ChatGatewayModule {}
