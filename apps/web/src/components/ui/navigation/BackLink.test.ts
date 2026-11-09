import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, createWebHistory } from 'vue-router';

import { IPage, usePageStore } from '@/stores/page';

import BackLink from './BackLink.vue';

const PAGE = { template: '<div />' };

const ROUTES = [
  { path: '/nodes', component: PAGE },
  { path: '/nodes/:nodeId', component: PAGE },
  { path: '/deployments/:deploymentId', component: PAGE },
  { path: '/deployments/:deploymentId/instance/:instanceKey', component: PAGE },
  { path: '/error', component: PAGE },
];

const register = (path: string, page: Partial<IPage>) => {
  usePageStore().register(path, { title: '', transient: false, ...page });
};

const mountAt = async ([firstPath, ...laterPaths]: string[]) => {
  window.history.replaceState(null, '', '/');

  const router = createRouter({ history: createWebHistory(), routes: ROUTES });

  await router.replace(firstPath);

  for (const path of laterPaths) {
    await router.push(path);
  }

  const wrapper = mount(BackLink, { global: { plugins: [router] } });

  return { wrapper, router };
};

beforeEach(() => {
  setActivePinia(createPinia());

  register('/nodes/1', { title: 'node-a-01', back: '/nodes' });
  register('/deployments/4/instance/abc', { title: 'Instance abc', back: '/deployments/4' });
});

describe('UiBackLink', () => {
  it('steps back to the page it came from, labelled with that page', async () => {
    register('/deployments/3', { title: 'llama-70b' });

    const { wrapper, router } = await mountAt(['/deployments/3', '/nodes/1']);
    const back = vi.spyOn(router, 'back');

    expect(wrapper.text()).toBe('llama-70b');
    expect(wrapper.get('a').attributes('href')).toBe('/deployments/3');

    await wrapper.get('a').trigger('click');

    expect(back).toHaveBeenCalled();
  });

  it('labels its back route with the title that page showed', async () => {
    register('/deployments/4', { title: 'llama-70b' });

    const { wrapper } = await mountAt(['/deployments/4/instance/abc']);

    expect(wrapper.text()).toBe('llama-70b');
  });

  it('opens its back route on a deep link, labelled Back while that page is unseen', async () => {
    const { wrapper, router } = await mountAt(['/nodes/1']);
    const back = vi.spyOn(router, 'back');

    expect(wrapper.text()).toBe('Back');

    await wrapper.get('a').trigger('click');
    await flushPromises();

    expect(back).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/nodes');
  });

  it('opens its back route when the previous page is not a page of the console', async () => {
    const { wrapper } = await mountAt(['/error', '/nodes/1']);

    expect(wrapper.get('a').attributes('href')).toBe('/nodes');
  });

  it('renders nothing on a page with no back route', async () => {
    register('/deployments/3', { title: 'llama-70b' });
    register('/nodes', { title: 'Nodes' });

    const { wrapper } = await mountAt(['/deployments/3', '/nodes']);

    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('leaves a modified click to the browser', async () => {
    register('/deployments/3', { title: 'llama-70b' });

    const { wrapper, router } = await mountAt(['/deployments/3', '/nodes/1']);
    const back = vi.spyOn(router, 'back');

    await wrapper.get('a').trigger('click', { ctrlKey: true });

    expect(back).not.toHaveBeenCalled();
  });
});
