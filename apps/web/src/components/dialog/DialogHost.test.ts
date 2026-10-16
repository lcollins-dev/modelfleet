import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { DialogType } from '@/types/dialog';

import { useDialogStore } from '@/stores/dialog';

import DialogHost from './DialogHost.vue';

// jsdom's HTMLDialogElement has neither showModal nor close.
beforeEach(() => {
  setActivePinia(createPinia());
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

describe('DialogHost', () => {
  it('shows the top dialog and answers its promise when it closes', async () => {
    const wrapper = mount(DialogHost);
    const answer = useDialogStore().confirm({
      type: DialogType.INFO,
      title: 'Run Purge now?',
      message: 'It runs once in the background.',
      confirmLabel: 'Run Now',
    });
    await nextTick();

    expect(wrapper.text()).toContain('Run Purge now?');

    await wrapper.get('[data-testid="dialog-confirm"]').trigger('click');

    expect(await answer).toBe(true);
    expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
  });
});
