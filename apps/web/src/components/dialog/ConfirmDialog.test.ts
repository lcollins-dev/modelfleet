import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from 'vue';

import { DialogType, IDialogOptions } from '@/types/dialog';

import ConfirmDialog from './ConfirmDialog.vue';

const OPTIONS: IDialogOptions = {
  type: DialogType.INFO,
  title: 'Run Purge now?',
  message: 'It runs once in the background.',
  confirmLabel: 'Run Now',
};

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

const mountDialog = (options: IDialogOptions) => mount(ConfirmDialog, { props: { options } });

const confirmButton = (wrapper: ReturnType<typeof mountDialog>) => wrapper.get('[data-testid="dialog-confirm"]');

describe('ConfirmDialog', () => {
  it('shows the title, message and a primary confirm button, and closes confirmed on click', async () => {
    const wrapper = mountDialog(OPTIONS);

    expect(wrapper.text()).toContain('Run Purge now?');
    expect(wrapper.text()).toContain('It runs once in the background.');
    expect(confirmButton(wrapper).classes()).toContain('bg-primary');

    await confirmButton(wrapper).trigger('click');

    expect(wrapper.emitted('close')).toEqual([[true]]);
  });

  it('renders a message with markup', () => {
    const wrapper = mountDialog({
      ...OPTIONS,
      message: () => h('span', ['This deletes ', h('strong', 'sam@example.com')]),
    });

    expect(wrapper.get('strong').text()).toBe('sam@example.com');
  });

  it('keeps a message holding a list out of a paragraph', () => {
    const wrapper = mountDialog({
      ...OPTIONS,
      message: () => h('div', [h('p', 'This stops:'), h('ul', [h('li', 'rig-01'), h('li', 'rig-02')])]),
    });

    expect(wrapper.find('p ul').exists()).toBe(false);
    expect(wrapper.get('[data-testid="dialog-message"] ul').findAll('li')).toHaveLength(2);
  });

  it('closes unconfirmed from Cancel', async () => {
    const wrapper = mountDialog({ ...OPTIONS, cancelLabel: 'Stay' });

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Stay')
      ?.trigger('click');

    expect(wrapper.emitted('close')).toEqual([[false]]);
  });

  it('keeps a danger confirm disabled until the confirm text is typed, ignoring case', async () => {
    const wrapper = mountDialog({
      ...OPTIONS,
      type: DialogType.DANGER,
      confirmText: 'sam@example.com',
      confirmTextLabel: 'Type their email to confirm',
    });

    expect(wrapper.text()).toContain('Type their email to confirm');
    expect(confirmButton(wrapper).classes()).toContain('bg-error');
    expect(confirmButton(wrapper).attributes('disabled')).toBeDefined();

    await wrapper.get('input[name="confirm-text"]').setValue(' SAM@example.com ');

    expect(confirmButton(wrapper).attributes('disabled')).toBeUndefined();
  });

  it('stays open and loading while the action runs, then closes confirmed', async () => {
    let finishAction: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishAction = resolve;
        })
    );
    const wrapper = mountDialog({ ...OPTIONS, action });

    await confirmButton(wrapper).trigger('click');
    await confirmButton(wrapper).trigger('click');

    expect(action).toHaveBeenCalledTimes(1);
    expect(confirmButton(wrapper).attributes('aria-busy')).toBe('true');
    expect(wrapper.emitted('close')).toBeUndefined();

    finishAction();
    await flushPromises();

    expect(wrapper.emitted('close')).toEqual([[true]]);
  });

  it('stays open and idle when the action fails, so it can be tried again', async () => {
    const wrapper = mountDialog({ ...OPTIONS, action: vi.fn().mockRejectedValue(new Error('Refused')) });

    await confirmButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.emitted('close')).toBeUndefined();
    expect(confirmButton(wrapper).attributes('aria-busy')).toBeUndefined();
  });
});
