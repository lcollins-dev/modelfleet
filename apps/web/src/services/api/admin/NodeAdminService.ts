import {
  NodeDto,
  type NodeListRequestDto,
  NodeListResponseDto,
  type RegisterNodeRequestDto,
  RegisterNodeResponseDto,
  type UpdateNodeRequestDto,
  type UpdateNodeStateRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useNodeAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getNodeList(
    nodeListRequest: NodeListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<NodeListResponseDto> {
    const nodeList = await apiService
      .makeRequest(`admin/node/list?page=${page}`, RequestType.PATCH, {
        response: NodeListResponseDto,
        token: userStore.token,
        body: nodeListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return nodeList;
  }

  /** The response carries the only readable copy of the secret. */
  async function registerNode(
    registerNodeRequest: RegisterNodeRequestDto,
    form: string | null = null
  ): Promise<RegisterNodeResponseDto> {
    const node = await apiService
      .makeRequest('admin/node', RequestType.POST, {
        response: RegisterNodeResponseDto,
        token: userStore.token,
        body: registerNodeRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return node;
  }

  async function getNode(nodeId: number, form: string | null = null): Promise<NodeDto> {
    const node = await apiService
      .makeRequest(`admin/node/${nodeId}`, RequestType.GET, {
        response: NodeDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return node;
  }

  async function updateNode(
    updateNodeRequest: UpdateNodeRequestDto,
    nodeId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/node/${nodeId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updateNodeRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function updateState(
    updateNodeStateRequest: UpdateNodeStateRequestDto,
    nodeId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/node/${nodeId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateNodeStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function deleteNode(nodeId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/node/${nodeId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getNodeList,
    registerNode,
    getNode,
    updateNode,
    updateState,
    deleteNode,
  };
};
