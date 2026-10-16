import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import AppSidebar, { INavSection } from './AppSidebar.vue';

const SECTIONS: INavSection[] = [
  { title: 'General', items: [{ label: 'Dashboard', to: '/dashboard' }] },
  {
    title: 'People',
    items: [
      { label: 'Users', to: '/users' },
      { label: 'User roles', to: '/users-roles' },
    ],
  },
];

const mountAt = async (path: string) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push(path);

  return mount(AppSidebar, { props: { sections: SECTIONS }, global: { plugins: [router] } });
};

describe('AppSidebar', () => {
  it('lists each section under its heading in a labelled navigation', async () => {
    const wrapper = await mountAt('/dashboard');

    expect(wrapper.get('nav').attributes('aria-label')).toBe('Main');
    expect(wrapper.text()).toContain('General');
    expect(wrapper.findAll('a').map(link => link.text())).toEqual(['Dashboard', 'Users', 'User roles']);
  });

  it('marks the item for the current page and the pages beneath it', async () => {
    const wrapper = await mountAt('/users/12');

    expect(wrapper.findAll('[aria-current="page"]').map(link => link.text())).toEqual(['Users']);
  });
});
