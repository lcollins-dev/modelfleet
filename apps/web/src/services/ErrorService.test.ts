import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, ApiErrorBase } from '@/types/api/error';
import { AppError, ValidationError } from '@/types/error';
import { Notification, NotificationType } from '@/types/notification';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { useErrorService } from './ErrorService';

describe('useErrorService', () => {
  let addNotificationMock: ReturnType<typeof vi.fn<(notification: Notification) => number>>;
  let setValidationErrorMock: ReturnType<typeof vi.fn<(error: ValidationError) => undefined>>;
  let clearValidationErrorMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    addNotificationMock = vi.fn<(notification: Notification) => number>();
    setValidationErrorMock = vi.fn<(error: ValidationError) => undefined>();
    clearValidationErrorMock = vi.fn<() => void>();

    useNotificationStore().addNotification = addNotificationMock;

    const errorStore = useErrorStore();
    errorStore.setValidationError = setValidationErrorMock;
    errorStore.clearValidationError = clearValidationErrorMock;
  });

  describe('handleError', () => {
    it('rethrows whatever it was given', () => {
      const error = new Error('unrelated');

      expect(() => useErrorService().handleError(error)).toThrow(error);
    });

    it('hands a validation error to the error store rather than raising a notification', () => {
      const error = new ValidationError('sign-in', {});

      expect(() => useErrorService().handleError(error)).toThrow(error);

      expect(setValidationErrorMock).toHaveBeenCalledWith(error);
      expect(addNotificationMock).not.toHaveBeenCalled();
    });

    it('raises an error notification for an app error', () => {
      const error = new AppError('Something broke');

      expect(() => useErrorService().handleError(error)).toThrow(error);

      expect(addNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Something broke', type: NotificationType.ERROR })
      );
    });

    it('clears the session when the api reports the request as unauthorized', () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');

      const error = new ApiError(ApiErrorBase.UNAUTHORIZED);

      expect(() => useErrorService().handleError(error)).toThrow(error);

      expect(userStore.loggedIn).toBe(false);
      expect(userStore.sessionEnded).toBe(true);
    });

    it('keeps the session for any other api error', () => {
      const userStore = useUserStore();
      userStore.setToken('signed-jwt');

      const error = new ApiError(ApiErrorBase.NOT_FOUND);

      expect(() => useErrorService().handleError(error)).toThrow(error);

      expect(userStore.loggedIn).toBe(true);
    });

    it('leaves an unrecognised error to the caller without notifying', () => {
      expect(() => useErrorService().handleError(new Error('unrelated'))).toThrow();

      expect(addNotificationMock).not.toHaveBeenCalled();
      expect(setValidationErrorMock).not.toHaveBeenCalled();
    });
  });

  describe('clearValidationError', () => {
    it('delegates to the error store', () => {
      useErrorService().clearValidationError();

      expect(clearValidationErrorMock).toHaveBeenCalled();
    });
  });
});
