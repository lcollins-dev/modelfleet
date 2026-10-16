import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModalStore } from '@/stores/modal';

import Modal from './Modal.vue';

const showModal = vi.fn(function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
});

// jsdom's HTMLDialogElement has neither showModal nor close.
beforeEach(() => {
  setActivePinia(createPinia());
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const mountModal = (show: boolean) =>
  mount(Modal, { props: { show, title: 'Delete Ann?' }, slots: { default: '<p>This cannot be undone.</p>' } });

describe('Modal', () => {
  it('opens as a modal dialog titled by its heading', () => {
    const wrapper = mountModal(true);
    const dialog = wrapper.get('dialog');

    expect(showModal).toHaveBeenCalled();
    expect(wrapper.get(`#${dialog.attributes('aria-labelledby')}`).text()).toBe('Delete Ann?');
    expect(wrapper.text()).toContain('This cannot be undone.');
  });

  it('renders nothing inside while closed', () => {
    const wrapper = mountModal(false);

    expect(wrapper.get('dialog').attributes('open')).toBeUndefined();
    expect(wrapper.text()).toBe('');
  });

  it('closes when its show prop turns off', async () => {
    const wrapper = mountModal(true);

    await wrapper.setProps({ show: false });

    expect(wrapper.get('dialog').attributes('open')).toBeUndefined();
  });

  it.each([
    ['its close button', 'button[aria-label="Close"]', 'click'],
    ['Escape', 'dialog', 'cancel'],
  ])('asks to close from %s', async (_name, selector, event) => {
    const wrapper = mountModal(true);

    await wrapper.get(selector).trigger(event);

    expect(wrapper.emitted('update:show')).toEqual([[false]]);
  });

  it('asks to close from a click on the backdrop', async () => {
    const wrapper = mountModal(true);

    await wrapper.get('dialog').trigger('mousedown');
    await wrapper.get('dialog').trigger('click');

    expect(wrapper.emitted('update:show')).toEqual([[false]]);
  });

  it('stays open when a selection dragged out of its card ends on the backdrop', async () => {
    const wrapper = mountModal(true);

    await wrapper.get('p').trigger('mousedown');
    await wrapper.get('dialog').trigger('click');

    expect(wrapper.emitted('update:show')).toBeUndefined();
  });

  it('lists itself as the open modal while shown', async () => {
    const wrapper = mountModal(true);

    expect(useModalStore().openModals).toEqual([wrapper.get('dialog').element]);

    await wrapper.setProps({ show: false });

    expect(useModalStore().openModals).toEqual([]);
  });

  it('follows a close the browser made itself', async () => {
    const wrapper = mountModal(true);

    await wrapper.get('dialog').trigger('close');

    expect(wrapper.emitted('update:show')).toEqual([[false]]);
    expect(useModalStore().openModals).toEqual([]);
  });

  it('drops itself from the open modals when unmounted while shown', () => {
    const wrapper = mountModal(true);

    wrapper.unmount();

    expect(useModalStore().openModals).toEqual([]);
  });

  it('stays open on a click inside its card', async () => {
    const wrapper = mountModal(true);

    await wrapper.get('p').trigger('click');

    expect(wrapper.emitted('update:show')).toBeUndefined();
  });
});
