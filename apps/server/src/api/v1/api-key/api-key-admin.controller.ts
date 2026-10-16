import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  ApiKeyListResponseDto,
  ApiKeyStatsResponseDto,
  CreateApiKeyResponseDto,
  UserRoleId,
  ApiKeyListRequestDto,
  CreateApiKeyRequestDto,
  IdParamDto,
  PageParamDto,
} from '@libs/dto';

import { AllowedRoles } from '../user/decorators/allowed-roles.decorator';
import { GetUser } from '../user/decorators/user.decorator';
import { ZodPipe } from '@/common/pipes/zod.pipe';

import { User } from '@/core/user/entities/user.entity';

import { ApiKeyAdminService } from './api-key-admin.service';

@Controller('api/v1/admin/api-key')
@AllowedRoles(UserRoleId.SYSTEM_ADMIN)
export class ApiKeyAdminController {
  constructor(private readonly apiKeyAdminService: ApiKeyAdminService) {}

  @Patch('list')
  getApiKeyList(
    @Body(new ZodPipe(ApiKeyListRequestDto)) apiKeyListRequest: ApiKeyListRequestDto,
    @Query('page', new ZodPipe(PageParamDto)) page: number
  ): Promise<ApiKeyListResponseDto> {
    return this.apiKeyAdminService.getApiKeyList(apiKeyListRequest, page);
  }

  @Get('stats')
  getApiKeyStats(): Promise<ApiKeyStatsResponseDto> {
    return this.apiKeyAdminService.getApiKeyStats();
  }

  @Post()
  createApiKey(
    @GetUser() user: User,
    @Body(new ZodPipe(CreateApiKeyRequestDto)) createApiKeyRequest: CreateApiKeyRequestDto
  ): Promise<CreateApiKeyResponseDto> {
    return this.apiKeyAdminService.createApiKey(createApiKeyRequest, user.id);
  }

  @Delete(':apiKeyId')
  revokeApiKey(@GetUser() user: User, @Param('apiKeyId', new ZodPipe(IdParamDto)) apiKeyId: number): Promise<void> {
    return this.apiKeyAdminService.revokeApiKey(apiKeyId, user.id);
  }
}
