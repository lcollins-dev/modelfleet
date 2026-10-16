import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Checkbox from './Checkbox.vue';

describe('Checkbox', () => {
  it('labels a native checkbox with its slot', () => {
    const wrapper = mount(Checkbox, { props: { checked: false }, slots: { default: 'I understand' } });

    expect(wrapper.get('label').text()).toBe('I understand');
    expect(wrapper.get('label').find('input[type="checkbox"]').exists()).toBe(true);
  });

  it('emits the new state when ticked', async () => {
    const wrapper = mount(Checkbox, { props: { checked: false } });

    await wrapper.get('input').setValue(true);

    expect(wrapper.emitted('update:checked')).toEqual([[true]]);
  });

  it('puts its attributes on the checkbox and its class on the label', () => {
    const wrapper = mount(Checkbox, {
      props: { checked: false },
      attrs: { 'data-testid': 'understood', class: 'mb-5' },
    });

    expect(wrapper.get('input').attributes('data-testid')).toBe('understood');
    expect(wrapper.get('label').classes()).toContain('mb-5');
  });

  it('marks itself mixed and shows a dash while indeterminate', () => {
    const wrapper = mount(Checkbox, { props: { checked: false, indeterminate: true } });

    expect(wrapper.get('input').attributes('aria-checked')).toBe('mixed');
    expect(wrapper.get('input').element.indeterminate).toBe(true);
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('still emits the new state when ticked from indeterminate', async () => {
    const wrapper = mount(Checkbox, { props: { checked: false, indeterminate: true } });

    await wrapper.get('input').setValue(true);

    expect(wrapper.emitted('update:checked')).toEqual([[true]]);
  });
});
