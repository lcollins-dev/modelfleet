import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import Dropdown from './Dropdown.vue';

const mountDropdown = () =>
  mount(Dropdown, {
    slots: {
      trigger: `<template #trigger="{ open, toggle, panelId }">
        <button type="button" :aria-expanded="open" :aria-controls="panelId" @click="toggle">Open</button>
      </template>`,
      default: `<template #default="{ close }">
        <div data-testid="panel"><button type="button" @click="close">Done</button></div>
      </template>`,
    },
    attachTo: document.body,
  });

const trigger = (wrapper: ReturnType<typeof mountDropdown>) => wrapper.get('button[aria-expanded]');
const panel = (wrapper: ReturnType<typeof mountDropdown>) => wrapper.find('[data-testid="panel"]');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Dropdown', () => {
  it('toggles its panel from the trigger and names it for the trigger', async () => {
    const wrapper = mountDropdown();

    expect(panel(wrapper).exists()).toBe(false);

    await trigger(wrapper).trigger('click');

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(panel(wrapper).element.parentElement?.id).toBe(trigger(wrapper).attributes('aria-controls'));
    expect(wrapper.emitted('update:open')).toEqual([[true]]);

    await trigger(wrapper).trigger('click');

    expect(panel(wrapper).exists()).toBe(false);
  });

  it('closes from its panel', async () => {
    const wrapper = mountDropdown();

    await trigger(wrapper).trigger('click');
    await wrapper.get('[data-testid="panel"] button').trigger('click');

    expect(panel(wrapper).exists()).toBe(false);
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const wrapper = mountDropdown();

    await trigger(wrapper).trigger('click');
    await panel(wrapper).trigger('keydown', { key: 'Escape' });

    expect(panel(wrapper).exists()).toBe(false);
    expect(document.activeElement).toBe(trigger(wrapper).element);
  });

  it('closes on a click outside it', async () => {
    const wrapper = mountDropdown();

    await trigger(wrapper).trigger('click');
    // onClickOutside skips a click that lands in the same task as the one before it.
    await new Promise(resolve => setTimeout(resolve, 0));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new Event('click', { bubbles: true }));
    await nextTick();

    expect(panel(wrapper).exists()).toBe(false);
  });
});
