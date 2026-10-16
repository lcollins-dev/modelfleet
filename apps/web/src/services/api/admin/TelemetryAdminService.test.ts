import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeTelemetryStatusDto, NodeTelemetryState } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { useSseService } from '../SseService';
import { useTelemetryAdminService } from './TelemetryAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

vi.mock('../SseService', () => ({
  useSseService: vi.fn(),
}));

const NODE_ID = 7;
const TOKEN_OPTIONS = { token: 'signed-jwt' };

const STATUS: NodeTelemetryStatusDto = {
  telemetryState: NodeTelemetryState.OK,
  capturedAt: new Date('2026-08-20T12:00:00.000Z'),
  receivedAt: new Date('2026-08-20T12:00:00.000Z'),
  host: {
    cpuModel: 'AMD Ryzen 9 5950X',
    cpuCount: 32,
    loadAverage1m: 1.2,
    memoryTotalBytes: 67_386_753_024,
    memoryFreeBytes: 41_231_686_144,
    modelDirectories: [],
  },
  devices: [],
  errors: [],
  headroomBytes: 1_073_741_824,
};

describe('useTelemetryAdminService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let subscribeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue(STATUS);
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    subscribeMock = vi.fn().mockReturnValue({ connected: { value: true }, close: vi.fn() });

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: vi.fn(),
    } as unknown as ReturnType<typeof useErrorService>);
    vi.mocked(useSseService).mockReturnValue({
      subscribe: subscribeMock,
    } as unknown as ReturnType<typeof useSseService>);

    useUserStore().setToken('signed-jwt');
  });

  it('reads the status of one node', async () => {
    const telemetryAdminService = useTelemetryAdminService();

    await expect(telemetryAdminService.getNodeTelemetryStatus(NODE_ID)).resolves.toEqual(STATUS);

    expect(makeRequestMock).toHaveBeenCalledWith(`admin/node/${NODE_ID}/telemetry`, RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: NodeTelemetryStatusDto,
      form: null,
    });
  });

  it('hands a failed read to the error service', async () => {
    const telemetryAdminService = useTelemetryAdminService();

    makeRequestMock.mockRejectedValue(new Error('nope'));

    await expect(telemetryAdminService.getNodeTelemetryStatus(NODE_ID)).rejects.toThrow('nope');
    expect(handleErrorMock).toHaveBeenCalled();
  });

  it('subscribes to the stream of one node', () => {
    const telemetryAdminService = useTelemetryAdminService();
    const onStatus = vi.fn();
    const onReconnect = vi.fn();

    telemetryAdminService.streamNodeTelemetryStatus(NODE_ID, onStatus, onReconnect);

    expect(subscribeMock).toHaveBeenCalledWith(
      `admin/node/${NODE_ID}/telemetry/stream`,
      NodeTelemetryStatusDto,
      onStatus,
      {
        ...TOKEN_OPTIONS,
        onReconnect,
      }
    );
  });
});
