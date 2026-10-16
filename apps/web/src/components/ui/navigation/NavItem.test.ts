import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import NavItem from './NavItem.vue';

describe('UiNavItem', () => {
  it('links to its route, marked as the current page when active', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
    });
    await router.push('/');

    const wrapper = mount(NavItem, {
      props: { to: '/nodes', label: 'Nodes', active: true },
      global: { plugins: [router] },
    });

    expect(wrapper.get('a').attributes('href')).toBe('/nodes');
    expect(wrapper.get('a').attributes('aria-current')).toBe('page');
  });

  it('is a button that reports its clicks when it has no route', async () => {
    const wrapper = mount(NavItem, { props: { label: 'Backend', active: true } });
    const button = wrapper.get('button');

    await button.trigger('click');

    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-current')).toBe('true');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('marks nothing current while inactive', () => {
    const wrapper = mount(NavItem, { props: { label: 'Backend' } });

    expect(wrapper.get('button').attributes('aria-current')).toBeUndefined();
  });

  it('shows its count slot after a label that truncates', () => {
    const wrapper = mount(NavItem, { props: { label: 'Memory' }, slots: { count: '3' } });

    expect(wrapper.get('.truncate').text()).toBe('Memory');
    expect(wrapper.get('.font-mono').text()).toBe('3');
  });

  it('renders no count without the slot', () => {
    const wrapper = mount(NavItem, { props: { label: 'Memory' } });

    expect(wrapper.find('.font-mono').exists()).toBe(false);
  });
});
