import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Switch from './Switch.vue';

describe('Switch', () => {
  it('is a switch that reports its state', () => {
    const wrapper = mount(Switch, { props: { value: true } });
    const control = wrapper.get('button');

    expect(control.attributes('role')).toBe('switch');
    expect(control.attributes('aria-checked')).toBe('true');
  });

  it('flips its value when pressed', async () => {
    const wrapper = mount(Switch, { props: { value: false } });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([[true]]);
  });

  it('holds its value while loading', async () => {
    const wrapper = mount(Switch, { props: { value: false, loading: true } });

    await wrapper.get('button').trigger('click');

    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true');
  });

  it('puts the field ids on the native button', () => {
    const wrapper = mount(Switch, {
      props: { value: false },
      attrs: { id: 'field-input', 'aria-describedby': 'field-help', 'aria-invalid': true },
    });
    const control = wrapper.get('button');

    expect(control.attributes('id')).toBe('field-input');
    expect(control.attributes('aria-describedby')).toBe('field-help');
    expect(control.attributes('aria-invalid')).toBe('true');
  });
});
