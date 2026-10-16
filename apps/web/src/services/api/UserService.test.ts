import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileResponseDto, TokenResponseDto, UpdateProfileResponseDto } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';
import { useUserService } from './UserService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

const PROFILE = { name: 'Tester', email: 'tester@example.com', userRoleIds: [], mustChangePassword: false };

describe('useUserService', () => {
  let makeRequestMock: ReturnType<typeof vi.fn>;
  let handleErrorMock: ReturnType<typeof vi.fn>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn>;
  let clearTimedOutNotificationsMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    makeRequestMock = vi.fn();
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
  });

  describe('login', () => {
    it('posts the credentials under the given form', async () => {
      makeRequestMock.mockResolvedValueOnce({ token: 'signed-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().login({ email: 'tester@example.com', password: 'pw' }, 'sign-in');

      expect(makeRequestMock).toHaveBeenNthCalledWith(1, 'user/login', RequestType.POST, {
        response: TokenResponseDto,
        form: 'sign-in',
        body: { email: 'tester@example.com', password: 'pw' },
      });
    });

    it('stores the token and then loads the profile', async () => {
      makeRequestMock.mockResolvedValueOnce({ token: 'signed-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().login({ email: 'tester@example.com', password: 'pw' });

      const userStore = useUserStore();

      expect(userStore.token).toBe('signed-jwt');
      expect(userStore.profile).toEqual(PROFILE);
    });

    it('reads the profile with the freshly stored token', async () => {
      makeRequestMock.mockResolvedValueOnce({ token: 'signed-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().login({ email: 'tester@example.com', password: 'pw' });

      expect(makeRequestMock).toHaveBeenNthCalledWith(2, 'user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'signed-jwt',
      });
    });

    it('sweeps timed-out notifications once the login succeeds', async () => {
      makeRequestMock.mockResolvedValueOnce({ token: 'signed-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().login({ email: 'tester@example.com', password: 'pw' });

      expect(clearTimedOutNotificationsMock).toHaveBeenCalled();
    });

    it('clears the validation error whether the login succeeds or fails', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNKNOWN, 'Bad credentials'));

      await expect(useUserService().login({ email: 'tester@example.com', password: 'pw' })).rejects.toThrow();

      expect(clearValidationErrorMock).toHaveBeenCalled();
    });

    it('leaves the session untouched when the login fails', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNKNOWN, 'Bad credentials'));

      await expect(useUserService().login({ email: 'tester@example.com', password: 'pw' })).rejects.toThrow();

      expect(useUserStore().loggedIn).toBe(false);
    });
  });

  describe('getProfile', () => {
    it('sends the stored token', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      makeRequestMock.mockResolvedValue(PROFILE);

      await useUserService().getProfile();

      expect(makeRequestMock).toHaveBeenCalledWith('user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'signed-jwt',
      });
    });

    it('hands a failure to the error service and leaves the profile unset', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

      await expect(useUserService().getProfile()).rejects.toThrow();

      expect(useUserStore().profile).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('patches the profile and then reloads it', async () => {
      useUserStore().setToken('signed-jwt');
      makeRequestMock.mockResolvedValueOnce({}).mockResolvedValueOnce(PROFILE);

      await useUserService().updateProfile({ name: 'Renamed', email: 'tester@example.com' }, 'profile');

      expect(makeRequestMock).toHaveBeenNthCalledWith(1, 'user/profile', RequestType.PATCH, {
        response: UpdateProfileResponseDto,
        token: 'signed-jwt',
        form: 'profile',
        body: { name: 'Renamed', email: 'tester@example.com' },
      });
      expect(makeRequestMock).toHaveBeenNthCalledWith(2, 'user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'signed-jwt',
      });
    });

    it('swaps to the replacement token when the password changed', async () => {
      useUserStore().setToken('old-jwt');
      makeRequestMock.mockResolvedValueOnce({ token: 'new-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().updateProfile({ name: 'Tester', email: 'tester@example.com', password: 'pw' });

      expect(useUserStore().token).toBe('new-jwt');
    });

    it('reloads the profile with the replacement token', async () => {
      useUserStore().setToken('old-jwt');
      makeRequestMock.mockResolvedValueOnce({ token: 'new-jwt' }).mockResolvedValueOnce(PROFILE);

      await useUserService().updateProfile({ name: 'Tester', email: 'tester@example.com', password: 'pw' });

      expect(makeRequestMock).toHaveBeenNthCalledWith(2, 'user/profile', RequestType.GET, {
        response: ProfileResponseDto,
        token: 'new-jwt',
      });
    });

    it('keeps the current token when the response carries no replacement', async () => {
      useUserStore().setToken('signed-jwt');
      makeRequestMock.mockResolvedValueOnce({}).mockResolvedValueOnce(PROFILE);

      await useUserService().updateProfile({ name: 'Renamed', email: 'tester@example.com' });

      expect(useUserStore().token).toBe('signed-jwt');
    });

    it('does not reload the profile when the patch fails', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNKNOWN));

      await expect(useUserService().updateProfile({ name: 'Renamed', email: 'tester@example.com' })).rejects.toThrow();

      expect(makeRequestMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('logout', () => {
    it('calls the endpoint with the stored token', async () => {
      useUserStore().setToken('signed-jwt');
      makeRequestMock.mockResolvedValue(undefined);

      await useUserService().logout();

      expect(makeRequestMock).toHaveBeenCalledWith('user/logout', RequestType.POST, { token: 'signed-jwt' });
    });

    it('clears the session', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      userStore.setProfile(PROFILE);
      makeRequestMock.mockResolvedValue(undefined);

      await useUserService().logout();

      expect(userStore.loggedIn).toBe(false);
      expect(userStore.profile).toBeNull();
    });

    it('clears the session even when the endpoint fails', async () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.NETWORK));

      await useUserService().logout();

      expect(userStore.loggedIn).toBe(false);
    });
  });
});
