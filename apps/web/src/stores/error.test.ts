import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ValidationError } from '@/types/error';
import { Notification } from '@/types/notification';

import { useErrorStore } from './error';
import { useNotificationStore } from './notification';

const buildValidationError = (form: string | null = 'profile'): ValidationError =>
  new ValidationError(form, {
    email: { name: 'Email address', message: 'Enter a valid email address.' },
  });

describe('useErrorStore', () => {
  let addNotificationMock: ReturnType<typeof vi.fn<(notification: Notification) => number>>;
  let clearNotificationMock: ReturnType<typeof vi.fn<(id: number) => void>>;

  beforeEach(() => {
    setActivePinia(createPinia());

    addNotificationMock = vi.fn<(notification: Notification) => number>().mockReturnValue(3);
    clearNotificationMock = vi.fn<(id: number) => void>();

    const notificationStore = useNotificationStore();
    notificationStore.addNotification = addNotificationMock;
    notificationStore.clearNotification = clearNotificationMock;
  });

  describe('setVueError', () => {
    it('holds the error it was given', () => {
      const errorStore = useErrorStore();
      const error = new Error('render failed');

      errorStore.setVueError(error);

      expect(errorStore.vueError).toBe(error);
    });
  });

  describe('setValidationError', () => {
    it('raises a notification for the error', () => {
      const errorStore = useErrorStore();

      errorStore.setValidationError(buildValidationError());

      expect(addNotificationMock).toHaveBeenCalled();
    });

    it('reports the fields it can when one carries no error', () => {
      const errorStore = useErrorStore();

      errorStore.setValidationError(
        new ValidationError('profile', {
          name: undefined,
          email: { name: 'Email address', message: 'Enter a valid email address.' },
        })
      );

      expect(addNotificationMock).toHaveBeenCalled();
      expect(errorStore.getFieldError('profile', 'email')).toBe('Enter a valid email address.');
    });

    it('clears the notification raised by a previous validation error', () => {
      const errorStore = useErrorStore();

      errorStore.setValidationError(buildValidationError());
      errorStore.setValidationError(buildValidationError());

      expect(clearNotificationMock).toHaveBeenCalledWith(3);
    });
  });

  describe('getFieldError', () => {
    it('returns the message for a field of the matching form', () => {
      const errorStore = useErrorStore();
      errorStore.setValidationError(buildValidationError('profile'));

      expect(errorStore.getFieldError('profile', 'email')).toBe('Enter a valid email address.');
    });

    it('returns nothing for a field of a different form', () => {
      const errorStore = useErrorStore();
      errorStore.setValidationError(buildValidationError('profile'));

      expect(errorStore.getFieldError('sign-in', 'email')).toBeUndefined();
    });

    it('lands a refusal nested inside a field on that field', () => {
      const errorStore = useErrorStore();
      errorStore.setValidationError(
        new ValidationError('deployment', {
          'placement.gpus.deviceKey': { name: 'Device key', message: 'gpus[0].deviceKey must be a device key.' },
        })
      );

      expect(errorStore.getFieldError('deployment', 'placement')).toBe('gpus[0].deviceKey must be a device key.');
      expect(errorStore.getFieldError('deployment', 'placement.gpus.deviceKey')).toBe(
        'gpus[0].deviceKey must be a device key.'
      );
      expect(errorStore.getFieldError('deployment', 'place')).toBeUndefined();
    });

    it('returns nothing for a field that carries no error', () => {
      const errorStore = useErrorStore();
      errorStore.setValidationError(buildValidationError('profile'));

      expect(errorStore.getFieldError('profile', 'name')).toBeUndefined();
    });

    it('returns nothing when no validation error is held', () => {
      const errorStore = useErrorStore();

      expect(errorStore.getFieldError('profile', 'email')).toBeUndefined();
    });
  });

  describe('clearValidationError', () => {
    it('drops the held error and its notification', () => {
      const errorStore = useErrorStore();
      errorStore.setValidationError(buildValidationError('profile'));

      errorStore.clearValidationError();

      expect(clearNotificationMock).toHaveBeenCalledWith(3);
      expect(errorStore.getFieldError('profile', 'email')).toBeUndefined();
    });

    it('clears no notification when none was raised', () => {
      const errorStore = useErrorStore();

      errorStore.clearValidationError();

      expect(clearNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe('form labels', () => {
    it('returns a label registered against a form and path', () => {
      const errorStore = useErrorStore();

      errorStore.setFormLabel('profile', 'email', 'Email address');

      expect(errorStore.getFormLabel('profile', 'email')).toBe('Email address');
    });

    it('keeps labels of the same path apart by form', () => {
      const errorStore = useErrorStore();

      errorStore.setFormLabel('profile', 'email', 'Email address');
      errorStore.setFormLabel('sign-in', 'email', 'Account email');

      expect(errorStore.getFormLabel('sign-in', 'email')).toBe('Account email');
    });

    it('supports the unnamed form', () => {
      const errorStore = useErrorStore();

      errorStore.setFormLabel(null, 'email', 'Email address');

      expect(errorStore.getFormLabel(null, 'email')).toBe('Email address');
    });

    it('returns nothing for a path that was never registered', () => {
      const errorStore = useErrorStore();

      expect(errorStore.getFormLabel('profile', 'email')).toBeUndefined();
    });

    it('removes a single label and leaves its siblings', () => {
      const errorStore = useErrorStore();
      errorStore.setFormLabel('profile', 'email', 'Email address');
      errorStore.setFormLabel('profile', 'name', 'Full name');

      errorStore.removeFormLabel('profile', 'email');

      expect(errorStore.getFormLabel('profile', 'email')).toBeUndefined();
      expect(errorStore.getFormLabel('profile', 'name')).toBe('Full name');
    });

    it('drops the form entry once its last label is removed', () => {
      const errorStore = useErrorStore();
      errorStore.setFormLabel('profile', 'email', 'Email address');

      errorStore.removeFormLabel('profile', 'email');

      expect(errorStore.formLabelsMap.has('profile')).toBe(false);
    });

    it('ignores a removal for an unknown form or path', () => {
      const errorStore = useErrorStore();
      errorStore.setFormLabel('profile', 'email', 'Email address');

      errorStore.removeFormLabel('sign-in', 'email');
      errorStore.removeFormLabel('profile', 'name');

      expect(errorStore.getFormLabel('profile', 'email')).toBe('Email address');
    });

    it('prefers a registered label over the name carried by the error', () => {
      const errorStore = useErrorStore();
      errorStore.setFormLabel('profile', 'email', 'Work email');

      errorStore.setValidationError(buildValidationError('profile'));

      expect(errorStore.getFormLabel('profile', 'email')).toBe('Work email');
      expect(addNotificationMock).toHaveBeenCalled();
    });
  });
});
