import {
  type LoginRequestDto,
  ProfileResponseDto,
  TokenResponseDto,
  type UpdateProfileRequestDto,
  UpdateProfileResponseDto,
} from '@libs/dto';

import { RequestType } from '@/types/api';

import { useLogService } from '@/services/LogService';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

const logService = useLogService();
const logger = logService.createLogger('services/api/UserService');

export const useUserService = () => {
  const userStore = useUserStore();
  const notificationStore = useNotificationStore();

  const apiService = useApiService();
  const errorService = useErrorService();

  async function login(loginRequest: LoginRequestDto, form: string | null = null): Promise<TokenResponseDto> {
    const tokenResponse = await apiService
      .makeRequest('user/login', RequestType.POST, {
        response: TokenResponseDto,
        form,
        body: loginRequest,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
    userStore.setToken(tokenResponse.token);

    await getProfile();

    return tokenResponse;
  }

  async function getProfile(): Promise<ProfileResponseDto> {
    const profileResponse = await apiService
      .makeRequest('user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    userStore.setProfile(profileResponse);

    return profileResponse;
  }

  async function updateProfile(
    updateProfileRequest: UpdateProfileRequestDto,
    form: string | null = null
  ): Promise<void> {
    const updateProfileResponse = await apiService
      .makeRequest('user/profile', RequestType.PATCH, {
        response: UpdateProfileResponseDto,
        token: userStore.token,
        form,
        body: updateProfileRequest,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    // A password change replaces the session, so the token held here stops working.
    if (updateProfileResponse.token !== undefined) {
      userStore.setToken(updateProfileResponse.token);
    }

    notificationStore.clearTimedOutNotifications();

    await getProfile();
  }

  async function logout(): Promise<void> {
    await apiService
      .makeRequest('user/logout', RequestType.POST, {
        token: userStore.token,
      })
      .finally(() => {
        userStore.clearAuth();
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'logout(): Failed to call logout endpoint');
      });
  }

  return { login, getProfile, updateProfile, logout };
};
