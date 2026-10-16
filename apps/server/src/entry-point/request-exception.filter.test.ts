import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtendedBaseExceptionFilter } from '@/common/interceptors/ExtendedBaseExceptionFilter';

import { EntryPoint } from './entry-point';
import { RequestExceptionFilter } from './request-exception.filter';
import { OpenAiErrorFilter } from '@/gateway/errors/openai-error.filter';

const hostFor = (entryPoint: EntryPoint): ArgumentsHost =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ entryPoint }), getResponse: () => ({}) }),
  }) as unknown as ArgumentsHost;

describe('RequestExceptionFilter', () => {
  let gatewayCatch: ReturnType<typeof vi.spyOn>;
  let baseCatch: ReturnType<typeof vi.spyOn>;
  let filter: RequestExceptionFilter;

  beforeEach(() => {
    gatewayCatch = vi.spyOn(OpenAiErrorFilter.prototype, 'catch').mockImplementation(() => undefined);
    baseCatch = vi.spyOn(ExtendedBaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);

    filter = new RequestExceptionFilter({} as AbstractHttpAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers anything the gateway stamped in the OpenAI shape, validation failures included', () => {
    filter.catch(new BadRequestException(), hostFor(EntryPoint.GATEWAY));
    filter.catch(new NotFoundException(), hostFor(EntryPoint.GATEWAY));

    expect(gatewayCatch).toHaveBeenCalledTimes(2);
    expect(baseCatch).not.toHaveBeenCalled();
  });

  it('hands every management failure to the base filter, validation failures included', () => {
    filter.catch(new BadRequestException(), hostFor(EntryPoint.MANAGEMENT));
    filter.catch(new NotFoundException(), hostFor(EntryPoint.MANAGEMENT));

    expect(baseCatch).toHaveBeenCalledTimes(2);
    expect(gatewayCatch).not.toHaveBeenCalled();
  });
});
