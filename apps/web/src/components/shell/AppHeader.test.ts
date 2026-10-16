import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import AppHeader from './AppHeader.vue';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
});

const mountHeader = (props: Record<string, unknown> = {}) =>
  mount(AppHeader, {
    props,
    slots: { brand: 'Acme', actions: '<button>Theme</button>' },
    global: { plugins: [router] },
  });

describe('AppHeader', () => {
  it('links its brand home and shows its actions', () => {
    const wrapper = mountHeader();

    expect(wrapper.get('a').attributes('href')).toBe('/');
    expect(wrapper.get('a').text()).toBe('Acme');
    expect(wrapper.get('button').text()).toBe('Theme');
  });

  it('offers a menu button only when asked, reporting whether the menu is open', async () => {
    expect(mountHeader().find('button[aria-label="Menu"]').exists()).toBe(false);

    const wrapper = mountHeader({ showMenuButton: true, menuOpen: true });
    const menuButton = wrapper.get('button[aria-label="Menu"]');

    expect(menuButton.attributes('aria-expanded')).toBe('true');

    await menuButton.trigger('click');

    expect(wrapper.emitted('menu')).toHaveLength(1);
  });
});
