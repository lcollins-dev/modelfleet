import {
  type CreateUserRequestDto,
  type UpdateStateRequestDto,
  type UpdateUserRequestDto,
  UserDto,
  type UserListRequestDto,
  UserListResponseDto,
  type UserRoleDto,
  UserStatsResponseDto,
  CreateUserResponseDto,
  UserRoleListResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../../ErrorService';
import { useApiService } from '../ApiService';

export const useUserAdminService = () => {
  const apiService = useApiService();
  const errorService = useErrorService();

  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  async function getRoleList(): Promise<UserRoleDto[]> {
    const roleList = await apiService
      .makeRequest('admin/user/role/list', RequestType.GET, {
        response: UserRoleListResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return roleList;
  }

  async function getUserList(
    userListRequest: UserListRequestDto,
    page: number,
    form: string | null = null
  ): Promise<UserListResponseDto> {
    const userList = await apiService
      .makeRequest(`admin/user/list?page=${page}`, RequestType.PATCH, {
        response: UserListResponseDto,
        token: userStore.token,
        body: userListRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return userList;
  }

  async function getUserStats(): Promise<UserStatsResponseDto> {
    const stats = await apiService
      .makeRequest('admin/user/stats', RequestType.GET, {
        response: UserStatsResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return stats;
  }

  async function createUser(createUserRequest: CreateUserRequestDto, form: string | null = null): Promise<number> {
    const userId = await apiService
      .makeRequest(`admin/user`, RequestType.POST, {
        response: CreateUserResponseDto,
        token: userStore.token,
        body: createUserRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();

    return userId;
  }

  async function getUser(userId: number, form: string | null = null): Promise<UserDto> {
    const user = await apiService
      .makeRequest(`admin/user/${userId}`, RequestType.GET, {
        response: UserDto,
        token: userStore.token,
        form,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return user;
  }

  async function updateUser(
    updateUserRequest: UpdateUserRequestDto,
    userId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}`, RequestType.PATCH, {
        token: userStore.token,
        body: updateUserRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function updateState(
    updateStateRequest: UpdateStateRequestDto,
    userId: number,
    form: string | null = null
  ): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}/state`, RequestType.PATCH, {
        token: userStore.token,
        body: updateStateRequest,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  async function logoutAllSessions(userId: number, form: string | null = null): Promise<void> {
    await apiService
      .makeRequest(`admin/user/${userId}/logout-all-sessions`, RequestType.PATCH, {
        token: userStore.token,
        form,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getRoleList,
    getUserList,
    getUserStats,
    createUser,
    getUser,
    updateUser,
    updateState,
    logoutAllSessions,
  };
};
