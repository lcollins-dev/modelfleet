import { Injectable } from '@nestjs/common';
import { Response } from 'express';

import { BackendOperation } from '@libs/backends';
import { EmbeddingRequest } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { InferenceRequestService, JSON_TYPE } from '../../proxy/inference-request.service';
import { RelayProxyService } from '../../proxy/relay-proxy.service';

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly inferenceRequestService: InferenceRequestService,
    private readonly relayProxyService: RelayProxyService
  ) {}

  async embed(body: unknown, apiKey: ApiKey, response: Response): Promise<void> {
    const request = this.inferenceRequestService.parse(EmbeddingRequest, body);
    const resolved = await this.inferenceRequestService.resolve(request.model, BackendOperation.EMBEDDINGS);
    const mapping = resolved.mapping.embeddings;

    await this.relayProxyService.proxy({
      resolved,
      apiKey,
      response,
      operation: BackendOperation.EMBEDDINGS,
      upstreamBody: this.inferenceRequestService.jsonBody(resolved, request, mapping?.request),
      contentType: JSON_TYPE,
      streaming: false,
      mapBody: mapping?.response,
    });
  }
}
