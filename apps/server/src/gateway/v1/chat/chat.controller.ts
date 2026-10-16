import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';

import { GetApiKey } from '../../auth/api-key.decorator';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { ChatService } from './chat.service';

import { GATEWAY_ROUTE_PREFIX } from '../../gateway-routes';

@Controller(`${GATEWAY_ROUTE_PREFIX}/chat`)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('completions')
  complete(@Body() body: unknown, @GetApiKey() apiKey: ApiKey, @Res() response: Response): Promise<void> {
    return this.chatService.complete(body, apiKey, response);
  }
}
