import { NotificationListDto } from '@libs/dto';

import { RequestType } from '@/types/api';

import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from '../ErrorService';
import { useApiService } from './ApiService';

export const useNotificationService = () => {
  const notificationStore = useNotificationStore();
  const userStore = useUserStore();

  const apiService = useApiService();
  const errorService = useErrorService();

  async function getNotificationList(): Promise<NotificationListDto> {
    const response = await apiService
      .makeRequest('notification/list', RequestType.GET, {
        response: NotificationListDto,
        token: userStore.token,
      })
      .catch((error: unknown) => errorService.handleError(error));

    return response;
  }

  async function clearNotification(notificationId: number): Promise<void> {
    await apiService
      .makeRequest(`notification/${notificationId}/clear`, RequestType.PATCH, {
        token: userStore.token,
      })
      .finally(() => errorService.clearValidationError())
      .catch((error: unknown) => errorService.handleError(error));

    notificationStore.clearTimedOutNotifications();
  }

  return {
    getNotificationList,
    clearNotification,
  };
};
