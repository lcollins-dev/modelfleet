import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import MenuItem from './MenuItem.vue';

describe('MenuItem', () => {
  it('is a button by default', () => {
    const wrapper = mount(MenuItem, { slots: { default: 'Log out' } });

    expect(wrapper.get('button').attributes('type')).toBe('button');
    expect(wrapper.text()).toBe('Log out');
  });

  it('is a plain row when not interactive', () => {
    const wrapper = mount(MenuItem, { props: { interactive: false }, slots: { default: 'Export ready' } });

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toBe('Export ready');
  });
});
