import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationType } from '@/types/notification';

import { useNotificationStore } from '@/stores/notification';

import CopyButton from './CopyButton.vue';

const setClipboard = (clipboard: unknown): void => {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
};

describe('CopyButton', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    setClipboard(undefined);
  });

  it('writes the value to the clipboard and shows it was copied', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });

    const wrapper = mount(CopyButton, { props: { value: 'https://app.example/invite/abc' } });

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith('https://app.example/invite/abc');
    expect(wrapper.text()).toContain('Copied');
    expect(useNotificationStore().notifications).toHaveLength(0);
  });

  it('shows the failure notification and emits failed when the browser has no clipboard', async () => {
    setClipboard(undefined);

    const wrapper = mount(CopyButton, { props: { value: 'value', failureContent: 'Copy it by hand' } });

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(useNotificationStore().notifications).toEqual([
      expect.objectContaining({ type: NotificationType.ERROR, content: 'Copy it by hand', autoClose: true }),
    ]);
    expect(wrapper.emitted('failed')).toHaveLength(1);
  });

  it('shows the failure notification when the browser refuses the write', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });

    const wrapper = mount(CopyButton, { props: { value: 'value' } });

    await wrapper.find('button').trigger('click');
    await flushPromises();

    expect(useNotificationStore().notifications).toHaveLength(1);
    expect(wrapper.text()).toContain('Copy');
    expect(wrapper.text()).not.toContain('Copied');
  });
});
