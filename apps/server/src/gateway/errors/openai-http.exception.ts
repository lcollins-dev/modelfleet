import { HttpException, HttpStatus } from '@nestjs/common';

import { BackendError } from '@libs/backends/openai';

/** Nest serialises an object response body verbatim, so the OpenAI shape survives the filter above it. */
export class OpenAiHttpException extends HttpException {
  constructor(status: HttpStatus, body: BackendError) {
    super(body, status);
  }
}
