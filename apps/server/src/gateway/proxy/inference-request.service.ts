import { HttpStatus, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BackendOperation, StreamDialect } from '@libs/backends';
import { BackendErrorType, backendError } from '@libs/backends/openai';

import {
  DeploymentResolverService,
  IResolvedDeployment,
  ResolutionRefusal,
} from '@/core/inference/deployment-resolver.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

export const JSON_TYPE = 'application/json';

const INVALID_BODY_MESSAGE = 'The request body is invalid.';

const OPERATION_NAMES: Readonly<Record<BackendOperation, string>> = {
  [BackendOperation.CHAT_COMPLETIONS]: 'chat completions',
  [BackendOperation.EMBEDDINGS]: 'embeddings',
  [BackendOperation.TRANSCRIPTION]: 'transcription',
  [BackendOperation.TRANSLATION]: 'translation',
  [BackendOperation.SPEECH]: 'speech',
};

const STREAM_PARAMETER = 'stream';
const RESPONSE_FORMAT_PARAMETER = 'response_format';

/** Turns a caller's body and the name it sent as `model` into OpenAI's terms, refusals included. */
@Injectable()
export class InferenceRequestService {
  constructor(private readonly deploymentResolverService: DeploymentResolverService) {}

  parse<TSchema extends z.ZodType>(schema: TSchema, body: unknown): z.infer<TSchema> {
    const parsed = schema.safeParse(body);

    if (parsed.success) {
      return parsed.data;
    }

    const issue = parsed.error.issues.at(0);

    throw new OpenAiHttpException(
      HttpStatus.BAD_REQUEST,
      backendError(BackendErrorType.INVALID_REQUEST, issue?.message ?? INVALID_BODY_MESSAGE, {
        param: issue?.path.join('.'),
      })
    );
  }

  jsonBody<TRequest>(
    resolved: IResolvedDeployment,
    request: TRequest,
    map: ((request: TRequest) => unknown) | undefined
  ): Buffer {
    const mapped = map === undefined ? request : map(request);
    const upstreamModel = resolved.capability.upstreamModel;
    const body = upstreamModel === undefined || !this.isRecord(mapped) ? mapped : { ...mapped, model: upstreamModel };

    return Buffer.from(JSON.stringify(body));
  }

  checkStreaming(resolved: IResolvedDeployment, streaming: boolean, parameter = STREAM_PARAMETER): void {
    if (!streaming || resolved.capability.streaming !== StreamDialect.NONE) {
      return;
    }

    throw this.unsupported(parameter, `The model '${resolved.deployment.name}' does not support streaming.`);
  }

  checkResponseFormat(resolved: IResolvedDeployment, responseFormat: string | undefined): void {
    const accepted = resolved.capability.responseFormats;

    if (responseFormat === undefined || accepted === null || accepted.includes(responseFormat)) {
      return;
    }

    throw this.unsupported(
      RESPONSE_FORMAT_PARAMETER,
      `The model '${resolved.deployment.name}' does not support response_format '${responseFormat}'. It accepts ` +
        `${accepted.join(', ')}.`
    );
  }

  async resolve(name: string, operation: BackendOperation): Promise<IResolvedDeployment> {
    const result = await this.deploymentResolverService.resolve(name, operation);

    if (result.resolved !== null) {
      return result.resolved;
    }

    if (result.refusal === ResolutionRefusal.UNSUPPORTED_OPERATION) {
      throw new OpenAiHttpException(
        HttpStatus.NOT_FOUND,
        backendError(
          BackendErrorType.NOT_FOUND,
          `The model '${name}' does not support ${OPERATION_NAMES[operation]}.`,
          {
            code: 'unsupported_operation',
          }
        )
      );
    }

    throw new OpenAiHttpException(
      HttpStatus.NOT_FOUND,
      backendError(BackendErrorType.NOT_FOUND, `The model '${name}' does not exist.`, {
        param: 'model',
        code: 'model_not_found',
      })
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private unsupported(parameter: string, message: string): OpenAiHttpException {
    return new OpenAiHttpException(
      HttpStatus.BAD_REQUEST,
      backendError(BackendErrorType.INVALID_REQUEST, message, { param: parameter, code: 'unsupported_parameter' })
    );
  }
}
