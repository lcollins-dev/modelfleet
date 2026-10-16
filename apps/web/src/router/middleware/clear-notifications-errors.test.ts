import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteLocationNormalized } from 'vue-router';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';

import { clearNotificationsErrorMiddleware } from './clear-notifications-errors';

const ROUTE = { path: '/dashboard' } as RouteLocationNormalized;

describe('clearNotificationsErrorMiddleware', () => {
  let clearTimedOutNotificationsMock: ReturnType<typeof vi.fn<() => void>>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    clearTimedOutNotificationsMock = vi.fn<() => void>();
    clearValidationErrorMock = vi.fn<() => void>();

    useNotificationStore().clearTimedOutNotifications = clearTimedOutNotificationsMock;
    useErrorStore().clearValidationError = clearValidationErrorMock;
  });

  it('sweeps timed-out notifications on every navigation', () => {
    clearNotificationsErrorMiddleware.call(undefined, ROUTE, ROUTE, () => undefined);

    expect(clearTimedOutNotificationsMock).toHaveBeenCalled();
  });

  it('clears the validation error on every navigation', () => {
    clearNotificationsErrorMiddleware.call(undefined, ROUTE, ROUTE, () => undefined);

    expect(clearValidationErrorMock).toHaveBeenCalled();
  });
});
