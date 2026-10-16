import {
  type CreatePresetRequestDto,
  CreatePresetResponseDto,
  PresetDto,
  type PresetImpactRequestDto,
  PresetImpactResponseDto,
  type PresetListRequestDto,
  PresetListResponseDto,
  type UpdatePresetRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const usePresetAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getPresetList(
    presetListRequest: PresetListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<PresetListResponseDto> {
    const presetList = await apiService
      .makeRequest(`admin/preset/list?page=${page}`, RequestType.PATCH, {
        response: PresetListResponseDto,
        token: userStore.token,
        body: presetListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return presetList;
  }

  async function getPreset(presetId: number, form: string | null = null): Promise<PresetDto> {
    const preset = await apiService
      .makeRequest(`admin/preset/${presetId}`, RequestType.GET, {
        response: PresetDto,
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return preset;
  }

  async function createPreset(
    createPresetRequest: CreatePresetRequestDto,
    form: string | null = null
  ): Promise<CreatePresetResponseDto> {
    const created = await apiService
      .makeRequest('admin/preset', RequestType.POST, {
        response: CreatePresetResponseDto,
        token: userStore.token,
        body: createPresetRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return created;
  }

  /** Reports the count without writing the document. */
  async function getPresetImpact(
    presetId: number,
    presetImpactRequest: PresetImpactRequestDto,
    form: string | null = null
  ): Promise<PresetImpactResponseDto> {
    const impact = await apiService
      .makeRequest(`admin/preset/${presetId}/impact`, RequestType.PATCH, {
        response: PresetImpactResponseDto,
        token: userStore.token,
        body: presetImpactRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return impact;
  }

  async function updatePreset(
    presetId: number,
    updatePresetRequest: UpdatePresetRequestDto,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/preset/${presetId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updatePresetRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function deletePreset(presetId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/preset/${presetId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getPresetList,
    getPreset,
    createPreset,
    getPresetImpact,
    updatePreset,
    deletePreset,
  };
};
