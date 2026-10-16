import { HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendOperation, StreamDialect } from '@libs/backends';
import { BackendError, ChatCompletionRequest } from '@libs/backends/openai';

import { InferenceRequestService } from './inference-request.service';
import {
  DeploymentResolverService,
  IResolvedDeployment,
  ResolutionRefusal,
} from '@/core/inference/deployment-resolver.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

const bodyOf = (error: unknown): BackendError => (error as OpenAiHttpException).getResponse() as BackendError;

const statusOf = (error: unknown): number => (error as OpenAiHttpException).getStatus();

const refusalFrom = async (run: () => Promise<unknown>): Promise<unknown> => {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }

  throw new Error('The call was expected to be refused');
};

const transcribing = {
  deployment: { name: 'asr-2b' },
  capability: { path: '/v1/audio/transcriptions', responseFormats: ['json'], streaming: StreamDialect.NONE },
} as unknown as IResolvedDeployment;

const thrownBy = (run: () => void): unknown => {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }

  return undefined;
};

describe('InferenceRequestService', () => {
  let deploymentResolverService: { resolve: ReturnType<typeof vi.fn> };
  let inferenceRequestService: InferenceRequestService;

  beforeEach(() => {
    deploymentResolverService = { resolve: vi.fn() };
    inferenceRequestService = new InferenceRequestService(
      deploymentResolverService as unknown as DeploymentResolverService
    );
  });

  describe('jsonBody', () => {
    const speaking = (upstreamModel?: string): IResolvedDeployment =>
      ({
        deployment: { name: 'kokoro-voice' },
        capability: { path: '/v1/audio/speech', responseFormats: null, streaming: StreamDialect.NONE, upstreamModel },
      }) as unknown as IResolvedDeployment;

    const request = { model: 'kokoro-voice', input: 'Hello', voice: 'af_heart' };

    const sent = (resolved: IResolvedDeployment, map?: (body: typeof request) => unknown): unknown =>
      JSON.parse(inferenceRequestService.jsonBody(resolved, request, map).toString());

    it("sends the deployment's name where the backend names no model of its own", () => {
      expect(sent(speaking())).toEqual(request);
    });

    it('sends the name a backend insists on in place of the deployment name, after its mapping', () => {
      expect(sent(speaking('kokoro'), body => ({ ...body, model: 'mapped', speed: 1 }))).toEqual({
        ...request,
        model: 'kokoro',
        speed: 1,
      });
    });
  });

  it('answers the parsed body where the canonical schema accepts it', () => {
    const parsed = inferenceRequestService.parse(ChatCompletionRequest, {
      model: 'chat-8b',
      messages: [{ role: 'user', content: 'hi' }],
      my_own_parameter: 'kept',
    });

    expect(parsed.model).toBe('chat-8b');
    expect(parsed.my_own_parameter).toBe('kept');
  });

  it('refuses a body the canonical schema rejects, naming the field', () => {
    const thrown = ((): unknown => {
      try {
        inferenceRequestService.parse(ChatCompletionRequest, { model: 'chat-8b', messages: [] });
      } catch (error: unknown) {
        return error;
      }

      throw new Error('The body was expected to be refused');
    })();

    expect(statusOf(thrown)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error.type).toBe('invalid_request_error');
    expect(bodyOf(thrown).error.param).toBe('messages');
  });

  it('refuses an unknown model as model_not_found', async () => {
    deploymentResolverService.resolve.mockResolvedValue({
      resolved: null,
      refusal: ResolutionRefusal.UNKNOWN_MODEL,
    });

    const thrown = await refusalFrom(() =>
      inferenceRequestService.resolve('nothing-here', BackendOperation.CHAT_COMPLETIONS)
    );

    expect(statusOf(thrown)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(thrown).error).toMatchObject({ code: 'model_not_found', param: 'model' });
  });

  it('names the operation a backend does not serve', async () => {
    deploymentResolverService.resolve.mockResolvedValue({
      resolved: null,
      refusal: ResolutionRefusal.UNSUPPORTED_OPERATION,
    });

    const thrown = await refusalFrom(() => inferenceRequestService.resolve('chat-8b', BackendOperation.EMBEDDINGS));

    expect(statusOf(thrown)).toBe(HttpStatus.NOT_FOUND);
    expect(bodyOf(thrown).error.code).toBe('unsupported_operation');
    expect(bodyOf(thrown).error.message).toBe("The model 'chat-8b' does not support embeddings.");
  });

  it('refuses a response_format the operation does not accept, naming what it does', () => {
    const thrown = thrownBy(() => inferenceRequestService.checkResponseFormat(transcribing, 'srt'));

    expect(statusOf(thrown)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error).toMatchObject({
      type: 'invalid_request_error',
      code: 'unsupported_parameter',
      param: 'response_format',
      message: "The model 'asr-2b' does not support response_format 'srt'. It accepts json.",
    });
  });

  it('accepts a response_format the operation lists, or none at all', () => {
    expect(thrownBy(() => inferenceRequestService.checkResponseFormat(transcribing, 'json'))).toBeUndefined();
    expect(thrownBy(() => inferenceRequestService.checkResponseFormat(transcribing, undefined))).toBeUndefined();
  });

  it('accepts any response_format where the operation lists none', () => {
    const anyFormat = { ...transcribing, capability: { ...transcribing.capability, responseFormats: null } };

    expect(thrownBy(() => inferenceRequestService.checkResponseFormat(anyFormat, 'verbose_json'))).toBeUndefined();
  });

  it('refuses a stream the operation does not serve, under the parameter the caller named', () => {
    const thrown = thrownBy(() => inferenceRequestService.checkStreaming(transcribing, true, 'stream_format'));

    expect(statusOf(thrown)).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error).toMatchObject({ code: 'unsupported_parameter', param: 'stream_format' });
  });

  it('lets a request that does not stream through', () => {
    expect(thrownBy(() => inferenceRequestService.checkStreaming(transcribing, false))).toBeUndefined();
  });
});
