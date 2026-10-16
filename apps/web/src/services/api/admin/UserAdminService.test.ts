import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UserListStatus,
  UserRoleId,
  CreateUserResponseDto,
  UserDto,
  UserListResponseDto,
  UserRoleListResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';
import { useUserAdminService } from './UserAdminService';

vi.mock('../ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const TOKEN_OPTIONS = { token: 'signed-jwt' };

describe('useUserAdminService', () => {
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

  it('reads the role list', async () => {
    makeRequestMock.mockResolvedValue([{ id: UserRoleId.USER_ADMIN, name: 'User Admin' }]);

    const roleList = await useUserAdminService().getRoleList();

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/role/list', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: UserRoleListResponseDto,
    });
    expect(roleList).toHaveLength(1);
  });

  it('puts the page number in the query string and the filter in the body', async () => {
    makeRequestMock.mockResolvedValue({ userList: [], pages: 0 });

    await useUserAdminService().getUserList({ search: 'tester', status: UserListStatus.ALL }, 2, 'user-list');

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/list?page=2', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      response: UserListResponseDto,
      body: { search: 'tester', status: UserListStatus.ALL },
      form: 'user-list',
    });
  });

  it('reads the user stats', async () => {
    makeRequestMock.mockResolvedValue({ total: 3, enabled: 2, disabled: 1 });

    await expect(useUserAdminService().getUserStats()).resolves.toEqual({ total: 3, enabled: 2, disabled: 1 });
  });

  it('posts a new user and returns the id the api hands back', async () => {
    makeRequestMock.mockResolvedValue(42);

    const userId = await useUserAdminService().createUser(
      { name: 'Tester', email: 'tester@example.com', password: 'pw', userRoleIds: [] },
      'create-user'
    );

    expect(makeRequestMock.mock.calls[0][2]).toMatchObject({ response: CreateUserResponseDto });
    expect(userId).toBe(42);
    expect(clearTimedOutNotificationsMock).toHaveBeenCalled();
  });

  it('reads a single user by id', async () => {
    makeRequestMock.mockResolvedValue({ id: 42 });

    await useUserAdminService().getUser(42);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/42', RequestType.GET, {
      ...TOKEN_OPTIONS,
      response: UserDto,
      form: null,
    });
  });

  it('patches a user by id', async () => {
    await useUserAdminService().updateUser({ name: 'Renamed', email: 'tester@example.com', userRoleIds: [] }, 42);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/42', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      body: { name: 'Renamed', email: 'tester@example.com', userRoleIds: [] },
      form: null,
    });
  });

  it('patches the enabled state on its own endpoint', async () => {
    await useUserAdminService().updateState({ enabled: false }, 42);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/42/state', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      body: { enabled: false },
      form: null,
    });
  });

  it('invalidates every session of a user', async () => {
    await useUserAdminService().logoutAllSessions(42);

    expect(makeRequestMock).toHaveBeenCalledWith('admin/user/42/logout-all-sessions', RequestType.PATCH, {
      ...TOKEN_OPTIONS,
      form: null,
    });
  });

  it('hands a failure to the error service and skips the notification sweep', async () => {
    makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

    await expect(useUserAdminService().updateState({ enabled: false }, 42)).rejects.toThrow();

    expect(handleErrorMock).toHaveBeenCalled();
    expect(clearTimedOutNotificationsMock).not.toHaveBeenCalled();
  });
});
