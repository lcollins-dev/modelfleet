import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InputBox from './InputBox.vue';

const mountBox = (props: Record<string, unknown> = {}) => mount(InputBox, { props, slots: { default: '<input />' } });

describe('InputBox', () => {
  it('boxes its control without a chevron by default', () => {
    const wrapper = mountBox();

    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.classes()).toContain('focus-within:ring-3');
  });

  it('holds the focus ring and turns its chevron over while active', async () => {
    const wrapper = mountBox({ chevron: true });
    const chevron = wrapper.get('svg');

    expect(chevron.attributes('aria-hidden')).toBe('true');
    expect(chevron.classes()).not.toContain('rotate-180');
    expect(wrapper.classes()).not.toContain('ring-3');

    await wrapper.setProps({ active: true });

    expect(chevron.classes()).toContain('rotate-180');
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['border-primary', 'ring-3']));
  });

  it('drops the hover and focus treatment while disabled', () => {
    const wrapper = mountBox({ disabled: true });

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['cursor-not-allowed', 'text-muted']));
    expect(wrapper.classes()).not.toContain('hover:border-line-strong');
    expect(wrapper.classes()).not.toContain('focus-within:ring-3');
  });
});
