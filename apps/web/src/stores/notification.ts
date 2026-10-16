import { defineStore } from 'pinia';
import { ref } from 'vue';

import { Notification, NotificationType } from '@/types/notification';

const TOAST_TIMEOUT_MS = 3800;

const MAX_SHOWN = 4;

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<Notification[]>([]);

  let nextNotificationId = 0;

  function addNotification(notification: Notification) {
    notification.id = nextNotificationId++;

    // Deduplicate
    for (let i = notifications.value.length - 1; i >= 0; i--) {
      const checkNotification = notifications.value[i];

      if (checkNotification.content === notification.content) {
        clearNotification(checkNotification.id);
      }
    }

    notifications.value.push(notification);

    while (notifications.value.length > MAX_SHOWN) {
      clearNotification(notifications.value[0].id);
    }

    notification.timeoutHandle = setTimeout(() => {
      if (notification.autoClose) {
        clearNotification(notification.id);
      } else {
        timeOutNotification(notification.id);
      }
    }, notification.timeoutMs);
    clearTimedOutNotifications();

    return notification.id;
  }

  function timeOutNotification(id: number) {
    const notification = notifications.value.find(notification => notification.id === id);

    if (notification) {
      notification.timedOut = true;
    }
  }

  /** A success toast: a short title and a sentence saying what happened. */
  function addToast(title: string, content: string) {
    return addNotification(new Notification(content, NotificationType.SUCCESS, TOAST_TIMEOUT_MS, title));
  }

  function clearNotification(id: number) {
    const notificationIndex = notifications.value.findIndex(notification => notification.id === id);

    if (notificationIndex !== -1) {
      const notification = notifications.value[notificationIndex];

      if (notification.timeoutHandle !== null) {
        clearTimeout(notification.timeoutHandle);
        notification.timeoutHandle = null;
      }

      notifications.value.splice(notificationIndex, 1);
    }
  }

  function clearTimedOutNotifications() {
    for (let i = notifications.value.length - 1; i >= 0; i--) {
      const notification = notifications.value[i];

      if (notification.timedOut) {
        clearNotification(notification.id);
      }
    }
  }

  return {
    notifications,
    addNotification,
    addToast,
    clearNotification,
    clearTimedOutNotifications,
  };
});
