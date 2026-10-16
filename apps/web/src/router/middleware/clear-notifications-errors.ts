import { NavigationGuardWithThis } from 'vue-router';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';

export const clearNotificationsErrorMiddleware: NavigationGuardWithThis<undefined> = () => {
  const notificationStore = useNotificationStore();
  const errorStore = useErrorStore();

  notificationStore.clearTimedOutNotifications();
  errorStore.clearValidationError();
};
