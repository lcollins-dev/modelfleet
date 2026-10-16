import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';

import { ExtendedBaseExceptionFilter } from '@/common/interceptors/ExtendedBaseExceptionFilter';

import { EntryPoint, IEntryPointRequest } from './entry-point';
import { OpenAiErrorFilter } from '@/gateway/errors/openai-error.filter';

/**
 * The one global filter, answering in the error shape of whichever entry point took the request. It
 * sees what no controller filter can - a body the parser refused, or a path no route matched - since
 * those fail before routing chooses a controller.
 */
@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
  private readonly gatewayFilter = new OpenAiErrorFilter();
  private readonly baseFilter: ExtendedBaseExceptionFilter;

  constructor(httpAdapter: AbstractHttpAdapter) {
    this.baseFilter = new ExtendedBaseExceptionFilter(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<IEntryPointRequest>();

    if (request.entryPoint === EntryPoint.GATEWAY) {
      this.gatewayFilter.catch(exception, host);

      return;
    }

    this.baseFilter.catch(exception, host);
  }
}
