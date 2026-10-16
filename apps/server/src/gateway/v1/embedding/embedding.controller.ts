import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';

import { GetApiKey } from '../../auth/api-key.decorator';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { EmbeddingService } from './embedding.service';

import { GATEWAY_ROUTE_PREFIX } from '../../gateway-routes';

@Controller(`${GATEWAY_ROUTE_PREFIX}/embeddings`)
export class EmbeddingController {
  constructor(private readonly embeddingService: EmbeddingService) {}

  @Post()
  embed(@Body() body: unknown, @GetApiKey() apiKey: ApiKey, @Res() response: Response): Promise<void> {
    return this.embeddingService.embed(body, apiKey, response);
  }
}
