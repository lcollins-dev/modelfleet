import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

import { BackendError, BackendErrorType, backendError, errorTypeForStatus } from '@libs/backends/openai';

import { OpenAiHttpException } from './openai-http.exception';

const INTERNAL_MESSAGE = 'The server could not process your request because of an internal error.';

/** A body the parser refused, which carries its own status and a message safe to show the caller. */
interface IExposedHttpError {
  status: number;
  message: string;
  expose: true;
}

@Catch()
export class OpenAiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(OpenAiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = this.getStatus(exception);

    // An answer the gateway chose to give was logged where it was chosen, if at all.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR && !(exception instanceof OpenAiHttpException)) {
      this.logger.error({ error: exception }, 'catch(): Gateway request failed');
    }

    const body = this.getBody(exception, status);

    // A streaming caller waiting on a cold load was sent its head, so the status is spent and the error is an event,
    // which the OpenAI clients raise as they would the same body under a status.
    if (response.headersSent) {
      if (!response.writableEnded) {
        response.end(`data: ${JSON.stringify(body)}\n\n`);
      }

      return;
    }

    response.status(status).json(body);
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    return this.isExposedHttpError(exception) ? exception.status : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getBody(exception: unknown, status: number): BackendError {
    if (this.isExposedHttpError(exception)) {
      return backendError(BackendErrorType.INVALID_REQUEST, exception.message);
    }

    if (exception instanceof HttpException) {
      const thrown: unknown = exception.getResponse();
      const parsed = BackendError.safeParse(thrown);

      if (parsed.success) {
        return parsed.data;
      }

      if (status < HttpStatus.INTERNAL_SERVER_ERROR) {
        return backendError(errorTypeForStatus(status), this.getMessage(thrown, exception.message));
      }
    }

    return backendError(BackendErrorType.SERVER, INTERNAL_MESSAGE);
  }

  /** `HttpException` holds its body as a string, a `{ message }`, or a `{ message }` carrying an array. */
  private getMessage(thrown: unknown, fallback: string): string {
    if (typeof thrown === 'string') {
      return thrown;
    }

    if (typeof thrown !== 'object' || thrown === null || !('message' in thrown)) {
      return fallback;
    }

    const message: unknown = thrown.message;

    if (typeof message === 'string') {
      return message;
    }

    if (this.isStringArray(message)) {
      return message.join(', ');
    }

    return fallback;
  }

  /** The `http-errors` shape body-parser throws. It sets `expose` on a 4xx alone, so it is always the caller's fault. */
  private isExposedHttpError(value: unknown): value is IExposedHttpError {
    return (
      typeof value === 'object' &&
      value !== null &&
      'expose' in value &&
      value.expose === true &&
      'status' in value &&
      typeof value.status === 'number' &&
      'message' in value &&
      typeof value.message === 'string'
    );
  }

  private isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
  }
}
