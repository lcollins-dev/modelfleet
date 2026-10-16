import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CheckboxBox from './CheckboxBox.vue';

describe('CheckboxBox', () => {
  it('is an empty box hidden from assistive tech until checked', () => {
    const wrapper = mount(CheckboxBox, { props: { checked: false } });

    expect(wrapper.attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.classes()).toContain('border-line');
  });

  it('fills with a tick when checked', () => {
    const wrapper = mount(CheckboxBox, { props: { checked: true } });

    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['border-primary', 'bg-primary']));
  });

  it('borders an unchecked box in the primary colour while highlighted', () => {
    const wrapper = mount(CheckboxBox, { props: { checked: false, highlighted: true } });

    expect(wrapper.classes()).toContain('border-primary');
    expect(wrapper.classes()).not.toContain('bg-primary');
  });
});
