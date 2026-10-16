import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PageHeading from './PageHeading.vue';

describe('UiPageHeading', () => {
  it('titles the page with its title', () => {
    const wrapper = mount(PageHeading, { props: { title: 'Nodes' } });

    expect(wrapper.get('h1').text()).toBe('Nodes');
  });

  it('renders a rich title in place of the plain one', () => {
    const wrapper = mount(PageHeading, { slots: { title: '<span class="font-mono">node-a-01</span>' } });

    expect(wrapper.get('h1 span.font-mono').text()).toBe('node-a-01');
  });
});
