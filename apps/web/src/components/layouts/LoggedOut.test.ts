import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useThemeStore } from '@/stores/theme';

import LoggedOut from './LoggedOut.vue';

const mountAt = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push(path);

  return mount(LoggedOut, { global: { plugins: [router] } });
};

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('LoggedOut layout', () => {
  it('shows only the theme toggle, with no sidebar or menus', async () => {
    const wrapper = await mountAt('/sign-in');

    expect(wrapper.find('nav').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Menu"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="user-menu"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Toggle theme"]').exists()).toBe(true);
  });

  it('flips the theme from the header', async () => {
    const wrapper = await mountAt('/sign-in');

    await wrapper.get('button[aria-label="Toggle theme"]').trigger('click');

    expect(useThemeStore().isDarkMode).toBe(false);
  });
});
