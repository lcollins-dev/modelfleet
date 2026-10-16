import { FleetTelemetryResponseDto, NodeTelemetryStatusDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { ISseSubscription, useSseService } from '../SseService';

export const useTelemetryAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();
  const sseService = useSseService();

  const userStore = useUserStore();

  async function getNodeTelemetryStatus(nodeId: number, form: string | null = null): Promise<NodeTelemetryStatusDto> {
    const status = await apiService
      .makeRequest(`admin/node/${nodeId}/telemetry`, RequestType.GET, {
        response: NodeTelemetryStatusDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return status;
  }

  /** The stream opens with the current status, then sends one on each reading the node reports. */
  function streamNodeTelemetryStatus(
    nodeId: number,
    onStatus: (status: NodeTelemetryStatusDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe(`admin/node/${nodeId}/telemetry/stream`, NodeTelemetryStatusDto, onStatus, {
      token: userStore.token,
      onReconnect,
    });
  }

  async function getFleetTelemetry(form: string | null = null): Promise<FleetTelemetryResponseDto> {
    const fleet = await apiService
      .makeRequest('admin/telemetry', RequestType.GET, {
        response: FleetTelemetryResponseDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return fleet;
  }

  /** The stream opens with every node, then sends the fleet again at most once a second while nodes report. */
  function streamFleetTelemetry(
    onFleet: (fleet: FleetTelemetryResponseDto) => void,
    onReconnect?: () => void
  ): ISseSubscription {
    return sseService.subscribe('admin/telemetry/stream', FleetTelemetryResponseDto, onFleet, {
      token: userStore.token,
      onReconnect,
    });
  }

  return {
    getNodeTelemetryStatus,
    streamNodeTelemetryStatus,
    getFleetTelemetry,
    streamFleetTelemetry,
  };
};
