import { ExecutionContext, InternalServerErrorException, createParamDecorator } from '@nestjs/common';

import { IApiKeyRequest } from './api-key.guard';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

/** Reads what `ApiKeyGuard` hung on the request, so a route taking one has to mount that guard. */
// eslint-disable-next-line @typescript-eslint/naming-convention
export const GetApiKey = createParamDecorator((_data, ctx: ExecutionContext): ApiKey => {
  const apiKey = ctx.switchToHttp().getRequest<IApiKeyRequest>().apiKey;

  if (apiKey === undefined) {
    throw new InternalServerErrorException();
  }

  return apiKey;
});
