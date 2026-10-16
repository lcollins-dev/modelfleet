import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Notification, NotificationType } from '@/types/notification';

import { useNotificationStore } from './notification';

describe('useNotificationStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const contents = () => useNotificationStore().notifications.map(notification => notification.content);

  it('holds a notification with its type and content', () => {
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS));

    expect(notificationStore.notifications).toHaveLength(1);
    expect(notificationStore.notifications[0]).toMatchObject({ type: NotificationType.SUCCESS, content: 'Saved' });
  });

  it('hands out ascending ids', () => {
    const notificationStore = useNotificationStore();

    const first = notificationStore.addNotification(new Notification('First', NotificationType.INFO));
    const second = notificationStore.addNotification(new Notification('Second', NotificationType.INFO));

    expect(first).toBe(0);
    expect(second).toBe(1);
  });

  it('gives a new notification an id of its own after the list has emptied', () => {
    const notificationStore = useNotificationStore();

    const first = notificationStore.addNotification(new Notification('First', NotificationType.INFO));
    notificationStore.clearNotification(first);

    const second = notificationStore.addNotification(new Notification('Second', NotificationType.INFO));

    expect(second).not.toBe(first);
  });

  it('cancels the pending timeout of a notification that is cleared', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    const id = notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS, 4000));

    expect(vi.getTimerCount()).toBe(1);

    notificationStore.clearNotification(id);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets a notification live its full life after an earlier one was cleared', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    const first = notificationStore.addNotification(new Notification('First', NotificationType.ERROR, 4000));

    vi.advanceTimersByTime(1000);
    notificationStore.clearNotification(first);

    notificationStore.addNotification(new Notification('Second', NotificationType.ERROR, 4000));

    // The cleared notification's timeout would have fired by now.
    vi.advanceTimersByTime(3000);
    notificationStore.clearTimedOutNotifications();

    expect(contents()).toEqual(['Second']);
  });

  it('replaces an existing notification carrying the same content', () => {
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Duplicate', NotificationType.ERROR));
    const second = notificationStore.addNotification(new Notification('Duplicate', NotificationType.ERROR));

    expect(notificationStore.notifications.map(notification => notification.id)).toEqual([second]);
  });

  it('leaves a notification with different content alone', () => {
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('First', NotificationType.INFO));
    notificationStore.addNotification(new Notification('Second', NotificationType.INFO));

    expect(contents()).toEqual(['First', 'Second']);
  });

  it('drops the oldest notification once more than four are shown', () => {
    const notificationStore = useNotificationStore();

    for (const content of ['One', 'Two', 'Three', 'Four', 'Five']) {
      notificationStore.addNotification(new Notification(content, NotificationType.INFO));
    }

    expect(contents()).toEqual(['Two', 'Three', 'Four', 'Five']);
  });

  it('removes a notification cleared by id', () => {
    const notificationStore = useNotificationStore();

    const id = notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS));
    notificationStore.clearNotification(id);

    expect(notificationStore.notifications).toHaveLength(0);
  });

  it('ignores a clear for an id that is not held', () => {
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS));
    notificationStore.clearNotification(99);

    expect(contents()).toEqual(['Saved']);
  });

  it('keeps a notification that has not reached its timeout', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS, 4000));

    vi.advanceTimersByTime(3999);
    notificationStore.clearTimedOutNotifications();

    expect(contents()).toEqual(['Saved']);
  });

  it('keeps a timed-out notification until the next sweep', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Saved', NotificationType.SUCCESS, 4000));

    vi.advanceTimersByTime(4000);

    expect(contents()).toEqual(['Saved']);

    notificationStore.clearTimedOutNotifications();

    expect(contents()).toEqual([]);
  });

  it('sweeps timed-out notifications when a new one is added', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Old', NotificationType.INFO, 4000));

    vi.advanceTimersByTime(4000);

    notificationStore.addNotification(new Notification('New', NotificationType.INFO, 4000));

    expect(contents()).toEqual(['New']);
  });

  it('closes an auto-closing notification when its timeout fires', () => {
    vi.useFakeTimers();

    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Copy failed', NotificationType.ERROR, 4000, null, true));

    vi.advanceTimersByTime(4000);

    expect(contents()).toEqual([]);
  });

  it('creates a titled success toast', () => {
    const notificationStore = useNotificationStore();

    notificationStore.addToast('Invite revoked', 'The link no longer works.');

    expect(notificationStore.notifications[0]).toMatchObject({
      type: NotificationType.SUCCESS,
      content: 'The link no longer works.',
      title: 'Invite revoked',
    });
  });
});
