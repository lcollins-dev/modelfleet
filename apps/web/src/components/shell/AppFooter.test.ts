import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { Config } from '@/Config';

import AppFooter from './AppFooter.vue';

describe('AppFooter', () => {
  it('links to the source code and names the running version', () => {
    const wrapper = mount(AppFooter);

    const link = wrapper.get('a');

    expect(link.attributes('href')).toBe('https://github.com/lcollins-dev/modelfleet');
    expect(link.attributes('target')).toBe('_blank');
    expect(link.text()).toBe('Source code');
    expect(wrapper.text()).toContain(`Modelfleet ${Config.VERSION}`);
  });
});
