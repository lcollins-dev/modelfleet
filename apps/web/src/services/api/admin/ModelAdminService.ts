import {
  type ListModelDto,
  ModelDto,
  type ModelListRequestDto,
  ModelListResponseDto,
  NodeModelInventoryResponseDto,
  type UpdateModelRequestDto,
  type ModelType,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useModelAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getModelList(
    modelListRequest: ModelListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<ModelListResponseDto> {
    const modelList = await apiService
      .makeRequest(`admin/model/list?page=${page}`, RequestType.PATCH, {
        response: ModelListResponseDto,
        token: userStore.token,
        body: modelListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return modelList;
  }

  /** The catalogue search matches a fingerprint as readily as a name, so the exact match is picked from its answer. */
  async function findModelByFingerprint(fingerprint: string, type: ModelType): Promise<ListModelDto | undefined> {
    const { modelList } = await getModelList({ search: fingerprint, type: [type] }, 1);

    return modelList.find(model => model.fingerprint === fingerprint);
  }

  async function getModel(modelId: number, form: string | null = null): Promise<ModelDto> {
    const model = await apiService
      .makeRequest(`admin/model/${modelId}`, RequestType.GET, {
        response: ModelDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return model;
  }

  async function updateModel(
    updateModelRequest: UpdateModelRequestDto,
    modelId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/model/${modelId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updateModelRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function deleteModel(modelId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/model/${modelId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function getNodeModelInventory(
    nodeId: number,
    form: string | null = null
  ): Promise<NodeModelInventoryResponseDto> {
    const inventory = await apiService
      .makeRequest(`admin/node/${nodeId}/model`, RequestType.GET, {
        response: NodeModelInventoryResponseDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return inventory;
  }

  async function scanNodeModels(nodeId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/node/${nodeId}/model/scan`, RequestType.POST, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getModelList,
    findModelByFingerprint,
    getModel,
    updateModel,
    deleteModel,
    getNodeModelInventory,
    scanNodeModels,
  };
};
