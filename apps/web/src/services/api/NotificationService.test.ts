import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationListDto } from '@libs/dto';

import { RequestType } from '@/types/api';
import { ApiError, ApiErrorBase } from '@/types/api/error';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';
import { useNotificationService } from './NotificationService';

vi.mock('./ApiService', () => ({
  useApiService: vi.fn(),
}));

vi.mock('../ErrorService', () => ({
  useErrorService: vi.fn(),
}));

describe('useNotificationService', () => {
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
    useUserStore().setToken('signed-jwt');
  });

  describe('getNotificationList', () => {
    it('reads the list with the stored token', async () => {
      makeRequestMock.mockResolvedValue({ notificationList: [] });

      const response = await useNotificationService().getNotificationList();

      expect(makeRequestMock).toHaveBeenCalledWith('notification/list', RequestType.GET, {
        response: NotificationListDto,
        token: 'signed-jwt',
      });
      expect(response).toEqual({ notificationList: [] });
    });

    it('hands a failure to the error service', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNAUTHORIZED));

      await expect(useNotificationService().getNotificationList()).rejects.toThrow();

      expect(handleErrorMock).toHaveBeenCalled();
    });
  });

  describe('clearNotification', () => {
    it('patches the addressed notification', async () => {
      makeRequestMock.mockResolvedValue(undefined);

      await useNotificationService().clearNotification(12);

      expect(makeRequestMock).toHaveBeenCalledWith('notification/12/clear', RequestType.PATCH, {
        token: 'signed-jwt',
      });
    });

    it('sweeps timed-out notifications once the call succeeds', async () => {
      makeRequestMock.mockResolvedValue(undefined);

      await useNotificationService().clearNotification(12);

      expect(clearTimedOutNotificationsMock).toHaveBeenCalled();
    });

    it('leaves the on-screen notifications alone when the call fails', async () => {
      makeRequestMock.mockRejectedValue(new ApiError(ApiErrorBase.UNKNOWN));

      await expect(useNotificationService().clearNotification(12)).rejects.toThrow();

      expect(clearValidationErrorMock).toHaveBeenCalled();
      expect(clearTimedOutNotificationsMock).not.toHaveBeenCalled();
    });
  });
});
