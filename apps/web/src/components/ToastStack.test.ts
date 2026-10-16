import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { h, nextTick } from 'vue';

import { Notification, NotificationType } from '@/types/notification';

import { useNotificationStore } from '@/stores/notification';

import ToastStack from './ToastStack.vue';

describe('ToastStack', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountStack = () => mount(ToastStack, { global: { stubs: { teleport: true, transition: false } } });

  it('shows each notification with its title and text, oldest first', async () => {
    const wrapper = mountStack();
    const notificationStore = useNotificationStore();

    notificationStore.addToast('Profile updated', 'Your changes have been saved.');
    notificationStore.addNotification(new Notification('Something went wrong', NotificationType.ERROR));
    await nextTick();

    const items = wrapper.findAll('[data-testid^="notification-"]');

    expect(items.map(item => item.attributes('data-testid'))).toEqual(['notification-success', 'notification-error']);
    expect(items[0].text()).toContain('Profile updated');
    expect(items[0].text()).toContain('Your changes have been saved.');
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

    notificationStore.addToast('Invite revoked', 'The link no longer works.');
    await nextTick();
    await wrapper.get('button[aria-label="Close"]').trigger('click');

    expect(notificationStore.notifications).toHaveLength(0);
  });
});
