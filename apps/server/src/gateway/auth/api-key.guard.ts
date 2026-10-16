import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';

import { BackendErrorType, backendError } from '@libs/backends/openai';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { ApiKeyService } from '@/core/api-key/api-key.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

const BEARER_PREFIX = 'Bearer ';

const INVALID_KEY_MESSAGE = 'The API key is incorrect. You can manage API keys in the console.';

export interface IApiKeyRequest {
  headers: Record<string, string | string[] | undefined>;
  apiKey?: ApiKey;
}

/**
 * Authenticates an inference caller and hangs the key on the request. Mounted on the gateway
 * listener, which serves OpenAI's error form rather than the management API's.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IApiKeyRequest>();
    const token = this.readBearerToken(req);

    if (token === null) {
      throw this.refuse();
    }

    const apiKey = await this.apiKeyService.verify(token);

    if (!apiKey) {
      throw this.refuse();
    }

    req.apiKey = apiKey;

    return true;
  }

  private readBearerToken(req: IApiKeyRequest): string | null {
    const header = req.headers.authorization;

    if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
      return null;
    }

    const token = header.slice(BEARER_PREFIX.length).trim();

    return token.length > 0 ? token : null;
  }

  /** One refusal for every cause, so a caller cannot probe which keys exist. */
  private refuse(): OpenAiHttpException {
    return new OpenAiHttpException(
      HttpStatus.UNAUTHORIZED,
      backendError(BackendErrorType.AUTHENTICATION, INVALID_KEY_MESSAGE, { code: 'invalid_api_key' })
    );
  }
}
