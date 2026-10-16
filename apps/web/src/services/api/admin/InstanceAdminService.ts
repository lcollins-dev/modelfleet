import {
  DeploymentInstancesResponseDto,
  InstanceListResponseDto,
  InstanceOutputFrameDto,
  NodeInstancesResponseDto,
  type PlacementPreviewRequestDto,
  PlacementPreviewResponseDto,
  StartInstanceResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { ISseRefusal, ISseSubscription, useSseService } from '../SseService';

export const useInstanceAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();
  const sseService = useSseService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getDeploymentInstances(
    deploymentId: number,
    form: string | null = null
  ): Promise<DeploymentInstancesResponseDto> {
    const instances = await apiService
      .makeRequest(`admin/deployment/${deploymentId}/instance`, RequestType.GET, {
        response: DeploymentInstancesResponseDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return instances;
  }

  /**
   * The stream opens with the current set, then sends one on every write to any instance in the fleet, on an edit,
   * enable or disable of the deployment, and on telemetry from the nodes its placement refuses.
   */
  function streamDeploymentInstances(
    deploymentId: number,
    onInstances: (instances: DeploymentInstancesResponseDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe(
      `admin/deployment/${deploymentId}/instance/stream`,
      DeploymentInstancesResponseDto,
      onInstances,
      { token: userStore.token, onReconnect }
    );
  }

  async function getNodeInstances(nodeId: number, form: string | null = null): Promise<NodeInstancesResponseDto> {
    const instances = await apiService
      .makeRequest(`admin/node/${nodeId}/instance`, RequestType.GET, {
        response: NodeInstancesResponseDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return instances;
  }

  function streamNodeInstances(
    nodeId: number,
    onInstances: (instances: NodeInstancesResponseDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe(`admin/node/${nodeId}/instance/stream`, NodeInstancesResponseDto, onInstances, {
      token: userStore.token,
      onReconnect,
    });
  }

  /** The stream opens with every instance in the fleet, then sends them all again on every write to any of them. */
  function streamInstances(
    onInstances: (instances: InstanceListResponseDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe('admin/instance/stream', InstanceListResponseDto, onInstances, {
      token: userStore.token,
      onReconnect,
    });
  }

  /** Each open re-reads the tail and records a read, so close the subscription on `ended` rather than reconnecting. */
  function streamInstanceOutput(
    deploymentId: number,
    instanceKey: string,
    onFrame: (frame: InstanceOutputFrameDto) => void,
    onRefusal: (refusal: ISseRefusal) => void
  ): ISseSubscription {
    return sseService.subscribe(
      `admin/deployment/${deploymentId}/instance/${instanceKey}/output/stream`,
      InstanceOutputFrameDto,
      onFrame,
      { token: userStore.token, onRefusal }
    );
  }

  /** Leaves a failure to the caller, since the error service would notify on every edit a form is part-way through. */
  function previewPlacement(request: PlacementPreviewRequestDto): Promise<PlacementPreviewResponseDto> {
    return apiService.makeRequest('admin/instance/placement-preview', RequestType.PATCH, {
      response: PlacementPreviewResponseDto,
      token: userStore.token,
      body: request,
    });
  }

  async function startDeployment(deploymentId: number, form: string | null = null): Promise<StartInstanceResponseDto> {
    const started = await apiService
      .makeRequest(`admin/deployment/${deploymentId}/instance`, RequestType.POST, {
        response: StartInstanceResponseDto,
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return started;
  }

  async function stopDeployment(deploymentId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/deployment/${deploymentId}/instance`, RequestType.DELETE, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getDeploymentInstances,
    streamDeploymentInstances,
    getNodeInstances,
    streamNodeInstances,
    streamInstances,
    streamInstanceOutput,
    previewPlacement,
    startDeployment,
    stopDeployment,
  };
};
