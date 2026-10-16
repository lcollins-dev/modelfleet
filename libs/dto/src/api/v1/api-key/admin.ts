import { z } from 'zod';

import { enumValue, optionalText, requestBody, text } from '../../../fields';
import { ListApiKeyDto } from './api-key';

export enum ApiKeyListStatus {
  ANY = 'any',
  ACTIVE = 'active',
  REVOKED = 'revoked',
}

export const ApiKeyListRequestDto = requestBody({
  /** Matches a key's name or its public identifier. */
  search: optionalText(512),

  status: enumValue(ApiKeyListStatus).optional(),
});
export type ApiKeyListRequestDto = z.infer<typeof ApiKeyListRequestDto>;

export const ApiKeyListResponseDto = z.object({
  apiKeyList: z.array(ListApiKeyDto),
  pages: z.number(),
});
export type ApiKeyListResponseDto = z.infer<typeof ApiKeyListResponseDto>;

export const CreateApiKeyRequestDto = requestBody({
  name: text(1, 128, { trim: true }),
});
export type CreateApiKeyRequestDto = z.infer<typeof CreateApiKeyRequestDto>;

export const CreateApiKeyResponseDto = z.object({
  apiKey: ListApiKeyDto,

  /** The only readable copy; the row keeps a hash of its secret half alone. */
  token: z.string(),
});
export type CreateApiKeyResponseDto = z.infer<typeof CreateApiKeyResponseDto>;

export const ApiKeyStatsResponseDto = z.object({
  total: z.number(),
  active: z.number(),
  revoked: z.number(),
});
export type ApiKeyStatsResponseDto = z.infer<typeof ApiKeyStatsResponseDto>;
