import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useToastStore } from '@/stores/toast';

import ToastStack from './ToastStack.vue';

describe('ToastStack', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountStack = () => mount(ToastStack, { global: { stubs: { transition: false } } });

  it('shows titles with optional detail, oldest first', async () => {
    const wrapper = mountStack();
    const toastStore = useToastStore();

    toastStore.addToast('Key created');
    toastStore.addToast('Key revoked', 'It no longer works.');
    await nextTick();

    const toasts = wrapper.findAll('[data-testid="toast"]').map(toast => toast.text());

    expect(toasts).toEqual(['Key created.', 'Key revoked. It no longer works.']);
  });

  it('dismisses a toast when it is clicked', async () => {
    const wrapper = mountStack();
    const toastStore = useToastStore();

    toastStore.addToast('Profile updated', 'Your changes have been saved.');
    await nextTick();
    await wrapper.get('[data-testid="toast"]').trigger('click');

    expect(toastStore.toasts).toHaveLength(0);
  });
});
