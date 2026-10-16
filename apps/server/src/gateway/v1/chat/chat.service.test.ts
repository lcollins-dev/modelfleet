import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StreamDialect } from '@libs/backends';
import { BackendError } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';
import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { InferenceRequestService } from '../../proxy/inference-request.service';
import { RelayProxyService } from '../../proxy/relay-proxy.service';
import { ChatService } from './chat.service';
import { DeploymentResolverService, IResolvedDeployment } from '@/core/inference/deployment-resolver.service';

import { OpenAiHttpException } from '../../errors/openai-http.exception';

const CHAT_REQUEST = { model: 'chat-8b', messages: [{ role: 'user', content: 'hi' }] };

const bodyOf = (error: unknown): BackendError => (error as OpenAiHttpException).getResponse() as BackendError;

const statusOf = (error: unknown): number => (error as OpenAiHttpException).getStatus();

const resolvedWith = (streaming: StreamDialect): IResolvedDeployment =>
  ({
    deployment: { id: 3, name: 'chat-8b' } as Deployment,
    backend: 'llama.cpp',
    capability: { path: '/v1/chat/completions', responseFormats: null, streaming },
    mapping: {
      chatCompletions: {
        request: (request: object) => ({ ...request, mapped: true }),
        response: (body: unknown) => body,
        chunk: (chunk: unknown) => chunk,
      },
    },
  }) as unknown as IResolvedDeployment;

describe('ChatService', () => {
  let deploymentResolverService: { resolve: ReturnType<typeof vi.fn> };
  let relayProxyService: { proxy: ReturnType<typeof vi.fn> };
  let chatService: ChatService;

  beforeEach(() => {
    deploymentResolverService = {
      resolve: vi.fn().mockResolvedValue({ resolved: resolvedWith(StreamDialect.OPENAI), refusal: null }),
    };
    relayProxyService = { proxy: vi.fn().mockResolvedValue(undefined) };

    chatService = new ChatService(
      new InferenceRequestService(deploymentResolverService as unknown as DeploymentResolverService),
      relayProxyService as unknown as RelayProxyService
    );
  });

  it('hands the proxy the mapped request as JSON', async () => {
    await chatService.complete(CHAT_REQUEST, { id: 1 } as ApiKey, {} as Response);

    const [call] = relayProxyService.proxy.mock.calls[0] as [{ upstreamBody: Buffer; contentType: string }];

    expect(JSON.parse(call.upstreamBody.toString())).toEqual({ ...CHAT_REQUEST, mapped: true });
    expect(call.contentType).toBe('application/json');
    expect(relayProxyService.proxy).toHaveBeenCalledWith(expect.objectContaining({ streaming: false }));
  });

  it('carries the streaming flag the caller asked for', async () => {
    await chatService.complete({ ...CHAT_REQUEST, stream: true }, { id: 1 } as ApiKey, {} as Response);

    expect(relayProxyService.proxy).toHaveBeenCalledWith(expect.objectContaining({ streaming: true }));
  });

  it('refuses a streamed request to a backend whose chat completions do not stream', async () => {
    deploymentResolverService.resolve.mockResolvedValue({ resolved: resolvedWith(StreamDialect.NONE), refusal: null });

    let thrown: unknown;

    try {
      await chatService.complete({ ...CHAT_REQUEST, stream: true }, { id: 1 } as ApiKey, {} as Response);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(statusOf(thrown)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error.param).toBe('stream');
    expect(bodyOf(thrown).error.message).toBe("The model 'chat-8b' does not support streaming.");
    expect(relayProxyService.proxy).not.toHaveBeenCalled();
  });
});
