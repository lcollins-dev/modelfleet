import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import { useThemeStore } from '@/stores/theme';
import { useUserStore } from '@/stores/user';

import Default from './Default.vue';

const WIDE_WIDTH = window.innerWidth;

const signIn = (userRoleIds: UserRoleId[]) => {
  const userStore = useUserStore();

  userStore.setToken('token');
  userStore.setProfile({ name: 'Ann Lee', email: 'ann@example.com', userRoleIds, mustChangePassword: false });
};

const mountAt = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push(path);

  const wrapper = mount(Default, {
    global: { plugins: [router], stubs: { NotificationsMenu: true } },
    attachTo: document.body,
  });

  return { wrapper, router };
};

type Wrapper = Awaited<ReturnType<typeof mountAt>>['wrapper'];

const sectionTitles = (wrapper: Wrapper) =>
  wrapper.findAll('nav > div:not([aria-hidden])').map(heading => heading.text());

const navLinks = (wrapper: Wrapper) => wrapper.findAll('nav a').map(link => link.text());

const openUserMenu = async (wrapper: Wrapper) => {
  await wrapper.get('[data-testid="user-menu"]').trigger('click');

  return wrapper.findAll('[role="menuitem"]').map(item => item.text());
};

const narrow = () => {
  window.innerWidth = 800;
  window.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  window.innerWidth = WIDE_WIDTH;
  document.body.innerHTML = '';
});

describe('Default layout', () => {
  it('gives a system admin every section but Access users, with the telemetry tag', async () => {
    signIn([UserRoleId.SYSTEM_ADMIN]);

    const { wrapper } = await mountAt('/dashboard');

    expect(sectionTitles(wrapper)).toEqual(['Fleet', 'Catalogue', 'Serving', 'Access', 'System']);
    expect(navLinks(wrapper)).toEqual([
      'Overview',
      'Nodes',
      'Models',
      'Downloads',
      'Deployments',
      'Presets',
      'API keys',
      'Event log',
      'Batch jobs',
    ]);
    expect(wrapper.find('[data-testid="telemetry-tag"]').exists()).toBe(true);
  });

  it('gives a user admin the overview and users, and no telemetry tag', async () => {
    signIn([UserRoleId.USER_ADMIN]);

    const { wrapper } = await mountAt('/dashboard');

    expect(sectionTitles(wrapper)).toEqual(['Fleet', 'Access']);
    expect(navLinks(wrapper)).toEqual(['Overview', 'Users']);
    expect(wrapper.find('[data-testid="telemetry-tag"]').exists()).toBe(false);
  });

  it('gives a user with no role the overview alone', async () => {
    signIn([]);

    const { wrapper } = await mountAt('/dashboard');

    expect(navLinks(wrapper)).toEqual(['Overview']);
  });

  it('keeps an item lit on the pages beneath it', async () => {
    signIn([UserRoleId.SYSTEM_ADMIN]);

    const { wrapper } = await mountAt('/nodes/12');

    expect(wrapper.findAll('[aria-current="page"]').map(link => link.text())).toEqual(['Nodes']);
  });

  it('offers API keys from the menu only to a system admin', async () => {
    signIn([UserRoleId.SYSTEM_ADMIN]);
    const { wrapper } = await mountAt('/dashboard');

    expect(await openUserMenu(wrapper)).toEqual(['Profile & security', 'API keys', 'Sign out']);

    document.body.innerHTML = '';
    setActivePinia(createPinia());
    signIn([UserRoleId.USER_ADMIN]);
    const { wrapper: userAdminWrapper } = await mountAt('/dashboard');

    expect(await openUserMenu(userAdminWrapper)).toEqual(['Profile & security', 'Sign out']);
  });

  it('takes the user to their profile from the menu', async () => {
    signIn([]);

    const { wrapper, router } = await mountAt('/dashboard');

    await openUserMenu(wrapper);
    await wrapper.get('[data-testid="menu-item-profile"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/edit-profile');
  });

  it('opens the sidebar over the page on a narrow screen, behind a scrim', async () => {
    narrow();
    signIn([UserRoleId.SYSTEM_ADMIN]);

    const { wrapper } = await mountAt('/dashboard');

    expect(wrapper.find('nav').exists()).toBe(false);

    await wrapper.get('button[aria-label="Menu"]').trigger('click');

    expect(wrapper.find('[data-testid="sidebar-drawer"] nav').exists()).toBe(true);
    expect(wrapper.get('button[aria-label="Menu"]').attributes('aria-expanded')).toBe('true');

    await wrapper.get('[data-testid="sidebar-scrim"]').trigger('click');

    expect(wrapper.find('nav').exists()).toBe(false);
  });

  it('closes the drawer on Escape', async () => {
    narrow();
    signIn([UserRoleId.SYSTEM_ADMIN]);

    const { wrapper } = await mountAt('/dashboard');

    await wrapper.get('button[aria-label="Menu"]').trigger('click');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();

    expect(wrapper.find('nav').exists()).toBe(false);
  });

  it('closes the drawer on navigation', async () => {
    narrow();
    signIn([UserRoleId.SYSTEM_ADMIN]);

    const { wrapper, router } = await mountAt('/dashboard');

    await wrapper.get('button[aria-label="Menu"]').trigger('click');
    await router.push('/nodes');
    await flushPromises();

    expect(wrapper.find('nav').exists()).toBe(false);
  });

  it('flips the theme from the header', async () => {
    signIn([]);

    const { wrapper } = await mountAt('/dashboard');

    await wrapper.get('button[aria-label="Toggle theme"]').trigger('click');

    expect(useThemeStore().isDarkMode).toBe(false);
  });
});
