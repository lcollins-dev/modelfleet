import { Injectable } from '@nestjs/common';
import { Response } from 'express';

import { BackendOperation } from '@libs/backends';
import { ChatCompletionRequest } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { InferenceRequestService, JSON_TYPE } from '../../proxy/inference-request.service';
import { RelayProxyService } from '../../proxy/relay-proxy.service';

@Injectable()
export class ChatService {
  constructor(
    private readonly inferenceRequestService: InferenceRequestService,
    private readonly relayProxyService: RelayProxyService
  ) {}

  async complete(body: unknown, apiKey: ApiKey, response: Response): Promise<void> {
    const request = this.inferenceRequestService.parse(ChatCompletionRequest, body);
    const resolved = await this.inferenceRequestService.resolve(request.model, BackendOperation.CHAT_COMPLETIONS);
    const streaming = request.stream === true;
    const mapping = resolved.mapping.chatCompletions;

    this.inferenceRequestService.checkStreaming(resolved, streaming);

    await this.relayProxyService.proxy({
      resolved,
      apiKey,
      response,
      operation: BackendOperation.CHAT_COMPLETIONS,
      upstreamBody: this.inferenceRequestService.jsonBody(resolved, request, mapping?.request),
      contentType: JSON_TYPE,
      streaming,
      mapBody: mapping?.response,
      mapChunk: mapping?.chunk,
    });
  }
}
