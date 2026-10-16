import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { NotificationDto, NotificationSeverity } from '@libs/dto';

import NotificationsMenu from './NotificationsMenu.vue';

const getNotificationList = vi.fn();

const clearNotification = vi.fn();

vi.mock('@/services/api/NotificationService', () => ({
  useNotificationService: () => ({ getNotificationList, clearNotification }),
}));

const NOTIFICATION: NotificationDto = {
  id: 1,
  notificationType: { id: 1, name: 'Export ready', severity: NotificationSeverity.SUCCESS },
  desc: 'Your export has finished.',
  createdDate: new Date(),
};

const mountMenu = async (notificationList: NotificationDto[]) => {
  getNotificationList.mockResolvedValue({ notificationList });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/downloads', component: { template: '<div />' } },
    ],
  });
  await router.push('/');

  const wrapper = mount(NotificationsMenu, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return Object.assign(wrapper, { router });
};

const trigger = (wrapper: Awaited<ReturnType<typeof mountMenu>>) => wrapper.get('button[aria-label="Notifications"]');

beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NotificationsMenu', () => {
  it('shows the unread count on its trigger', async () => {
    const wrapper = await mountMenu([NOTIFICATION]);

    expect(wrapper.get('[data-testid="notifications-count"]').text()).toBe('1');
  });

  it('lists the notifications in its panel', async () => {
    const wrapper = await mountMenu([NOTIFICATION]);

    await trigger(wrapper).trigger('click');

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('[data-testid="notifications-panel"]').text()).toContain('Export ready');
  });

  it('says when nothing is waiting and shows no count', async () => {
    const wrapper = await mountMenu([]);

    await trigger(wrapper).trigger('click');

    expect(wrapper.find('[data-testid="notifications-count"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="notifications-panel"]').text()).toContain('No notifications.');
    expect(wrapper.get('[data-testid="notifications-panel"]').text()).toContain('All caught up');
  });

  it('closes on Escape and returns focus to its trigger', async () => {
    const wrapper = await mountMenu([]);

    await trigger(wrapper).trigger('click');
    await wrapper.get('[data-testid="notifications-panel"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[data-testid="notifications-panel"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger(wrapper).element);
  });

  it('clears every notification at once, then reads the list again', async () => {
    const wrapper = await mountMenu([NOTIFICATION, { ...NOTIFICATION, id: 2 }]);

    clearNotification.mockResolvedValue(undefined);
    getNotificationList.mockResolvedValue({ notificationList: [] });

    await trigger(wrapper).trigger('click');

    const clearAll = wrapper.findAll('button').find(button => button.text() === 'Clear all');

    await clearAll?.trigger('click');
    await flushPromises();

    expect(clearNotification.mock.calls).toEqual([[1], [2]]);
    expect(wrapper.get('[data-testid="notifications-panel"]').text()).toContain('No notifications.');
  });

  it('dismisses one notification, then reads the list again', async () => {
    const wrapper = await mountMenu([NOTIFICATION]);

    clearNotification.mockResolvedValue(undefined);
    getNotificationList.mockResolvedValue({ notificationList: [] });

    await trigger(wrapper).trigger('click');
    await wrapper.get('button[aria-label="Dismiss"]').trigger('click');
    await flushPromises();

    expect(clearNotification).toHaveBeenCalledWith(1);
    expect(wrapper.get('[data-testid="notifications-panel"]').text()).toContain('No notifications.');
  });

  it('opens the page a notification points at, clears it and closes the panel', async () => {
    const withPage: NotificationDto = {
      ...NOTIFICATION,
      notificationType: { ...NOTIFICATION.notificationType, pageUrl: '/downloads' },
    };
    const wrapper = await mountMenu([withPage]);

    clearNotification.mockResolvedValue(undefined);

    await trigger(wrapper).trigger('click');
    await wrapper.get('[data-testid="notification-row"] button').trigger('click');
    await flushPromises();

    expect(wrapper.router.currentRoute.value.path).toBe('/downloads');
    expect(clearNotification).toHaveBeenCalledWith(1);
    expect(wrapper.find('[data-testid="notifications-panel"]').exists()).toBe(false);
  });
});
