import {
  type CreateDeploymentRequestDto,
  CreateDeploymentResponseDto,
  DeploymentDto,
  DeploymentConfigurationDto,
  type DeploymentListRequestDto,
  DeploymentListResponseDto,
  type PresetSwapRequestDto,
  PresetSwapResponseDto,
  type UpdateDeploymentRequestDto,
  type UpdateDeploymentStateRequestDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useDeploymentAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getDeploymentList(
    deploymentListRequest: DeploymentListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<DeploymentListResponseDto> {
    const deploymentList = await apiService
      .makeRequest(`admin/deployment/list?page=${page}`, RequestType.PATCH, {
        response: DeploymentListResponseDto,
        token: userStore.token,
        body: deploymentListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return deploymentList;
  }

  async function getDeployment(deploymentId: number, form: string | null = null): Promise<DeploymentDto> {
    const deployment = await apiService
      .makeRequest(`admin/deployment/${deploymentId}`, RequestType.GET, {
        response: DeploymentDto,
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return deployment;
  }

  async function getDeploymentConfiguration(
    deploymentId: number,
    form: string | null = null
  ): Promise<DeploymentConfigurationDto> {
    const configuration = await apiService
      .makeRequest(`admin/deployment/${deploymentId}/configuration`, RequestType.GET, {
        response: DeploymentConfigurationDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return configuration;
  }

  async function createDeployment(
    createDeploymentRequest: CreateDeploymentRequestDto,
    form: string | null = null
  ): Promise<CreateDeploymentResponseDto> {
    const created = await apiService
      .makeRequest('admin/deployment', RequestType.POST, {
        response: CreateDeploymentResponseDto,
        token: userStore.token,
        body: createDeploymentRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return created;
  }

  async function previewPresetSwap(
    deploymentId: number,
    presetSwapRequest: PresetSwapRequestDto,
    form: string | null = null
  ): Promise<PresetSwapResponseDto> {
    const preview = await apiService
      .makeRequest(`admin/deployment/${deploymentId}/preset-swap`, RequestType.PATCH, {
        response: PresetSwapResponseDto,
        token: userStore.token,
        body: presetSwapRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    return preview;
  }

  async function updateDeployment(
    deploymentId: number,
    updateDeploymentRequest: UpdateDeploymentRequestDto,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/deployment/${deploymentId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updateDeploymentRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function updateDeploymentState(
    deploymentId: number,
    updateDeploymentStateRequest: UpdateDeploymentStateRequestDto,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/deployment/${deploymentId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateDeploymentStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function deleteDeployment(deploymentId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/deployment/${deploymentId}`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function applyDeployment(deploymentId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/deployment/${deploymentId}/apply`, RequestType.POST, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getDeploymentList,
    getDeployment,
    getDeploymentConfiguration,
    createDeployment,
    previewPresetSwap,
    updateDeployment,
    updateDeploymentState,
    deleteDeployment,
    applyDeployment,
  };
};
