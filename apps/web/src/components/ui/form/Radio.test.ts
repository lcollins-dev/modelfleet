import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Radio from './Radio.vue';

describe('Radio', () => {
  it('labels a native radio in its group with its slot', () => {
    const wrapper = mount(Radio, {
      props: { selected: null, name: 'directory', value: '/models' },
      slots: { default: '/models' },
    });
    const input = wrapper.get('label input[type="radio"]');

    expect(wrapper.get('label').text()).toBe('/models');
    expect(input.attributes('name')).toBe('directory');
  });

  it('reads as chosen only while the group holds its value', () => {
    const chosen = mount(Radio, { props: { selected: '/models', name: 'directory', value: '/models' } });
    const other = mount(Radio, { props: { selected: '/bulk', name: 'directory', value: '/models' } });

    expect(chosen.get<HTMLInputElement>('input').element.checked).toBe(true);
    expect(other.get<HTMLInputElement>('input').element.checked).toBe(false);
  });

  it('emits its value when chosen', async () => {
    const wrapper = mount(Radio, { props: { selected: '/bulk', name: 'directory', value: '/models' } });

    await wrapper.get('input').trigger('change');

    expect(wrapper.emitted('update:selected')).toEqual([['/models']]);
  });

  it('puts its attributes on the radio and its class on the label', () => {
    const wrapper = mount(Radio, {
      props: { selected: null, name: 'directory', value: '/models' },
      attrs: { 'data-testid': 'directory', class: 'mb-5' },
    });

    expect(wrapper.get('input').attributes('data-testid')).toBe('directory');
    expect(wrapper.get('label').classes()).toContain('mb-5');
  });
});
