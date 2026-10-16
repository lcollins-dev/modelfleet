import {
  type ApiKeyListRequestDto,
  ApiKeyListResponseDto,
  ApiKeyStatsResponseDto,
  type CreateApiKeyRequestDto,
  CreateApiKeyResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useApiKeyAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getApiKeyList(
    apiKeyListRequest: ApiKeyListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<ApiKeyListResponseDto> {
    const apiKeyList = await apiService
      .makeRequest(`admin/api-key/list?page=${page}`, RequestType.PATCH, {
        response: ApiKeyListResponseDto,
        token: userStore.token,
        body: apiKeyListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return apiKeyList;
  }

  async function getApiKeyStats(form: string | null = null): Promise<ApiKeyStatsResponseDto> {
    const stats = await apiService
      .makeRequest('admin/api-key/stats', RequestType.GET, {
        response: ApiKeyStatsResponseDto,
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return stats;
  }

  async function createApiKey(
    createApiKeyRequest: CreateApiKeyRequestDto,
    form: string | null = null
  ): Promise<CreateApiKeyResponseDto> {
    const created = await apiService
      .makeRequest('admin/api-key', RequestType.POST, {
        response: CreateApiKeyResponseDto,
        token: userStore.token,
        body: createApiKeyRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return created;
  }

  async function revokeApiKey(apiKeyId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/api-key/${apiKeyId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getApiKeyList,
    getApiKeyStats,
    createApiKey,
    revokeApiKey,
  };
};
