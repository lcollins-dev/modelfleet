import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick } from 'vue';

import { Notification, NotificationType } from '@/types/notification';

import { useNotificationStore } from '@/stores/notification';

import NotificationStack from './NotificationStack.vue';

describe('NotificationStack', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountStack = () => mount(NotificationStack, { global: { stubs: { transition: false } } });

  it('shows each notification with its title and text, oldest first', async () => {
    const wrapper = mountStack();
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(
      new Notification('Started 1 instance.', NotificationType.SUCCESS, 4000, 'Partly started')
    );
    notificationStore.addNotification(new Notification('Something went wrong', NotificationType.ERROR));
    await nextTick();

    const items = wrapper.findAll('[data-testid^="notification-"]');

    expect(items.map(item => item.attributes('data-testid'))).toEqual(['notification-success', 'notification-error']);
    expect(items[0].text()).toContain('Partly started');
    expect(items[0].text()).toContain('Started 1 instance.');
    expect(items[1].text()).toContain('Something went wrong');
  });

  it('renders a notification whose content is a render function', async () => {
    const wrapper = mountStack();

    useNotificationStore().addNotification(
      new Notification(() => h('ul', [h('li', 'Email: Enter a valid email address.')]), NotificationType.ERROR)
    );
    await nextTick();

    expect(wrapper.get('li').text()).toBe('Email: Enter a valid email address.');
  });

  it('clears a notification from the store when its close button is pressed', async () => {
    const wrapper = mountStack();
    const notificationStore = useNotificationStore();

    notificationStore.addNotification(new Notification('Something went wrong', NotificationType.ERROR));
    await nextTick();
    await wrapper.get('button[aria-label="Close"]').trigger('click');

    expect(notificationStore.notifications).toHaveLength(0);
  });
});
