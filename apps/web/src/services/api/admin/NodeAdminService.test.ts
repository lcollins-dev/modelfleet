import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NodeState, NodeDto, NodeListResponseDto, RegisterNodeResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { useNodeAdminService } from './NodeAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'signed-jwt' };
const NODE_ID = 7;

describe('useNodeAdminService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;
  let clearTimedOutNotificationsMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn().mockResolvedValue(undefined);
    handleErrorMock = vi.fn((error: unknown) => {
      throw error;
    });
    clearValidationErrorMock = vi.fn();
    clearTimedOutNotificationsMock = vi.fn<() => void>();

    vi.mocked(useApiService).mockReturnValue({
      makeRequest: makeRequestMock,
    } as unknown as ReturnType<typeof useApiService>);
    vi.mocked(useErrorService).mockReturnValue({
      handleError: handleErrorMock,
      clearValidationError: clearValidationErrorMock,
    } as unknown as ReturnType<typeof useErrorService>);

    useNotificationStore().clearTimedOutNotifications = clearTimedOutNotificationsMock;
    useUserStore().setToken('signed-jwt');
  });

  it('puts the page number in the query string and the filter in the body', async () => {
    makeRequestMock.mockResolvedValue({ nodeList: [], pages: 0 });

    await useNodeAdminService().getNodeList({ state: [NodeState.ONLINE] }, 2, 'node-list');

    expect(makeRequestMock).toHaveBeenCalledWith('admin/node/list?page=2', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      response: NodeListResponseDto,
      body: { state: [NodeState.ONLINE] },
      form: 'node-list',
    });
  });

  it('registers a node and hands back the credentials it was issued', async () => {
    const registered = { id: NODE_ID, name: 'rig-01', nodeKey: 'a-key', secret: 'mfn_a-secret' };
    makeRequestMock.mockResolvedValue(registered);

    const response = await useNodeAdminService().registerNode({ name: 'rig-01', description: 'The rack A head node' });

    expect(makeRequestMock).toHaveBeenCalledWith('admin/node', RequestType.POST, {
      ...TOKEN_OPTIONS,
      response: RegisterNodeResponseDto,
      body: { name: 'rig-01', description: 'The rack A head node' },
      form: null,
    });
    expect(response).toBe(registered);
  });

  it('reads one node by its identifier', async () => {
    makeRequestMock.mockResolvedValue({ id: NODE_ID });

    await useNodeAdminService().getNode(NODE_ID);

    expect(makeRequestMock).toHaveBeenCalledWith(`admin/node/${NODE_ID}`, RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: NodeDto,
      form: null,
    });
  });

  it('updates a node through its own endpoint', async () => {
    await useNodeAdminService().updateNode({ name: 'rig-02', description: 'The rack A head node' }, NODE_ID);

    expect(makeRequestMock).toHaveBeenCalledWith(`admin/node/${NODE_ID}`, RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      body: { name: 'rig-02', description: 'The rack A head node' },
      form: null,
    });
  });

  it('updates node state through the state endpoint', async () => {
    await useNodeAdminService().updateState({ enabled: false }, NODE_ID);

    expect(makeRequestMock).toHaveBeenCalledWith(`admin/node/${NODE_ID}/state`, RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      body: { enabled: false },
      form: null,
    });
  });

  it('deletes a node', async () => {
    await useNodeAdminService().deleteNode(NODE_ID);

    expect(makeRequestMock).toHaveBeenCalledWith(`admin/node/${NODE_ID}`, RequestType.DELETE, {
      ...TOKEN_OPTIONS,
      form: null,
    });
  });

  it('hands a failed list to the error service', async () => {
    makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

    await expect(useNodeAdminService().getNodeList({}, 1)).rejects.toThrow();

    expect(handleErrorMock).toHaveBeenCalled();
    expect(clearTimedOutNotificationsMock).not.toHaveBeenCalled();
  });

  it('sweeps timed-out notifications once a list arrives', async () => {
    makeRequestMock.mockResolvedValue({ nodeList: [], pages: 0 });

    await useNodeAdminService().getNodeList({}, 1);

    expect(clearTimedOutNotificationsMock).toHaveBeenCalled();
  });
});
