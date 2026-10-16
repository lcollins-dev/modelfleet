import { Injectable } from '@nestjs/common';

import {
  ApiKeyListRequestDto,
  ApiKeyListResponseDto,
  ApiKeyStatsResponseDto,
  CreateApiKeyRequestDto,
  CreateApiKeyResponseDto,
  ListApiKeyDto,
} from '@libs/dto';

import { ApiKey } from '@/core/api-key/entities/api-key.entity';

import { ConfigService } from '@/config/config.service';
import { ApiKeyService } from '@/core/api-key/api-key.service';

@Injectable()
export class ApiKeyAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly apiKeyService: ApiKeyService
  ) {}

  async getApiKeyList(apiKeyListRequest: ApiKeyListRequestDto, page: number): Promise<ApiKeyListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [apiKeys, total] = await this.apiKeyService.findAndCount(
      { search: apiKeyListRequest.search, status: apiKeyListRequest.status },
      pageSize * (page - 1),
      pageSize
    );

    const ownerNames = await this.apiKeyService.findOwnerNames(apiKeys);

    return {
      apiKeyList: apiKeys.map(apiKey => this.getIListApiKey(apiKey, ownerNames.get(apiKey.userId))),
      pages: Math.ceil(total / pageSize),
    };
  }

  getApiKeyStats(): Promise<ApiKeyStatsResponseDto> {
    return this.apiKeyService.countByState();
  }

  /** The token is in this response and in no other, so nothing downstream can read it back. */
  async createApiKey(createApiKeyRequest: CreateApiKeyRequestDto, ownerId: number): Promise<CreateApiKeyResponseDto> {
    const { apiKey, token } = await this.apiKeyService.issue(createApiKeyRequest.name, ownerId);
    const ownerNames = await this.apiKeyService.findOwnerNames([apiKey]);

    return { apiKey: this.getIListApiKey(apiKey, ownerNames.get(apiKey.userId)), token };
  }

  revokeApiKey(apiKeyId: number, actorId: number): Promise<void> {
    return this.apiKeyService.revoke(apiKeyId, actorId);
  }

  private getIListApiKey(apiKey: ApiKey, ownerName: string | undefined): ListApiKeyDto {
    return {
      id: apiKey.id,
      keyId: apiKey.keyId,
      name: apiKey.name,
      ownerId: apiKey.userId,
      ownerName,
      lastUsedDate: apiKey.lastUsedDate ?? null,
      revokedDate: apiKey.revokedDate ?? null,
      createdDate: apiKey.createdDate,
    };
  }
}
