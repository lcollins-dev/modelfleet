import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import { usePageStore } from '@/stores/page';

import { useGoBack } from './useGoBack';

const PAGE = { template: '<div />' };

const ROUTES = [
  { path: '/models', component: PAGE },
  { path: '/nodes', component: PAGE },
  { path: '/nodes/register', component: PAGE },
  { path: '/nodes/:nodeId', component: PAGE },
];

const useGoBackAt = async ([firstPath, ...laterPaths]: string[]) => {
  window.history.replaceState(null, '', '/');

  const router = createRouter({ history: createWebHistory(), routes: ROUTES });

  await router.replace(firstPath);

  for (const path of laterPaths) {
    await router.push(path);
  }

  const used: { result?: ReturnType<typeof useGoBack> } = {};

  mount(
    defineComponent({
      setup() {
        used.result = useGoBack();

        return () => null;
      },
    }),
    { global: { plugins: [router] } }
  );

  if (used.result === undefined) {
    throw new Error('useGoBack did not run');
  }

  return { router, ...used.result };
};

beforeEach(() => {
  setActivePinia(createPinia());

  const pageStore = usePageStore();

  pageStore.register('/nodes/register', { title: 'Register node', back: '/nodes', transient: true });
  pageStore.register('/nodes/5', { title: 'node-a-01', back: '/nodes', transient: false });
  pageStore.register('/models', { title: 'Models', transient: false });
});

describe('useGoBack', () => {
  it('steps back to the page it came from', async () => {
    const { router, target, goBack } = await useGoBackAt(['/models', '/nodes/register']);
    const back = vi.spyOn(router, 'back');

    expect(target.value?.location.path).toBe('/models');

    goBack();

    expect(back).toHaveBeenCalled();
  });

  it('opens the back route on a deep link', async () => {
    const { router, goBack } = await useGoBackAt(['/nodes/register']);

    goBack();
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/nodes');
  });

  it('stays put on a page with no back route', async () => {
    const { router, target, goBack } = await useGoBackAt(['/nodes/5', '/models']);
    const back = vi.spyOn(router, 'back');

    expect(target.value).toBeNull();

    goBack();
    await flushPromises();

    expect(back).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe('/models');
  });

  it('replaces a deleted item with its back route, keeping the page before it', async () => {
    const { router, goBack } = await useGoBackAt(['/models', '/nodes/5']);

    goBack({ replace: true });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/nodes');
    expect(router.options.history.state.back).toBe('/models');
  });

  it('stays put on replace from a page with no back route', async () => {
    const { router, goBack } = await useGoBackAt(['/models']);

    goBack({ replace: true });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/models');
  });
});
