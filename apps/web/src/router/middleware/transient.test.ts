import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from 'vue';
import { NavigationFailureType, Router, createRouter, createWebHistory, isNavigationFailure } from 'vue-router';

import { usePageStore } from '@/stores/page';

import { isTransientStepBack, transientMiddleware } from './transient';

const PAGE = { template: '<div />' };

const ROUTES = [
  { path: '/nodes', component: PAGE },
  { path: '/nodes/register', component: PAGE },
  { path: '/nodes/:nodeId', component: PAGE },
  { path: '/models', component: PAGE },
];

const routers: Router[] = [];

// Installed in an app, as the guard reaches the router through useRouter.
const routerAt = async ([firstPath, ...laterPaths]: string[]) => {
  window.history.replaceState(null, '', firstPath);

  const router = createRouter({ history: createWebHistory(), routes: ROUTES });
  routers.push(router);

  router.beforeEach(transientMiddleware);
  createApp({ render: () => null }).use(router);
  await router.isReady();

  for (const path of laterPaths) {
    await router.push(path);
  }

  return router;
};

const nextCompletedNavigation = (router: Router) =>
  new Promise<void>(resolve => {
    const removeHook = router.afterEach((_to, _from, failure) => {
      if (failure === undefined) {
        removeHook();
        resolve();
      }
    });
  });

beforeEach(() => {
  setActivePinia(createPinia());

  usePageStore().register('/nodes/register', { title: 'Register node', back: '/nodes', transient: true });
});

afterEach(() => {
  for (const router of routers.splice(0)) {
    router.options.history.destroy();
  }
});

describe('transientMiddleware', () => {
  it('replaces the transient entry when leaving for any other page, keeping query and hash', async () => {
    const router = await routerAt(['/nodes', '/nodes/register']);

    await router.push('/nodes/7?tab=logs#top');

    expect(router.currentRoute.value.fullPath).toBe('/nodes/7?tab=logs#top');
    expect(router.options.history.state.back).toBe('/nodes');
  });

  it('steps back when leaving a transient page for the previous page, which keeps its query', async () => {
    const router = await routerAt(['/models', '/nodes?page=2', '/nodes/register']);

    const steppedBack = nextCompletedNavigation(router);
    const failure = await router.push('/nodes');
    await steppedBack;

    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/nodes?page=2');
    expect(router.options.history.state.back).toBe('/models');
    expect(router.options.history.state.forward).toBe('/nodes/register');
  });

  it('marks only the push it cancels to step back', async () => {
    const router = await routerAt(['/nodes', '/nodes/register']);

    const marked: boolean[] = [];
    router.afterEach(to => marked.push(isTransientStepBack(to)));

    const steppedBack = nextCompletedNavigation(router);
    await router.push('/nodes');
    await steppedBack;

    expect(marked).toEqual([true, false]);
  });

  it('leaves browser back and forward alone', async () => {
    const router = await routerAt(['/nodes', '/nodes/register']);

    const backDone = nextCompletedNavigation(router);
    router.back();
    await backDone;

    expect(router.currentRoute.value.path).toBe('/nodes');
    expect(router.options.history.state.forward).toBe('/nodes/register');

    const forwardDone = nextCompletedNavigation(router);
    router.forward();
    await forwardDone;

    expect(router.currentRoute.value.path).toBe('/nodes/register');
    expect(router.currentRoute.value.redirectedFrom).toBeUndefined();
    expect(router.options.history.state.back).toBe('/nodes');
  });

  it('lets a replace from a transient page through as a replace', async () => {
    const router = await routerAt(['/nodes', '/nodes/register']);

    await router.replace('/nodes/7');

    expect(router.currentRoute.value.path).toBe('/nodes/7');
    expect(router.options.history.state.back).toBe('/nodes');
    expect(router.options.history.state.forward).toBeNull();
  });

  it('pushes as usual from a page that is not transient, even to the previous page', async () => {
    const router = await routerAt(['/models', '/nodes']);

    await router.push('/models');

    expect(router.currentRoute.value.path).toBe('/models');
    expect(router.currentRoute.value.redirectedFrom).toBeUndefined();
    expect(router.options.history.state.back).toBe('/nodes');
  });

  it('lets its own replace through, so it redirects once', async () => {
    const router = await routerAt(['/nodes', '/nodes/register']);

    const targets: string[] = [];
    router.afterEach(to => targets.push(to.fullPath));

    let guardRuns = 0;
    router.beforeEach(() => {
      guardRuns += 1;
    });

    await router.push('/nodes/7');

    expect(guardRuns).toBe(1);
    expect(targets).toEqual(['/nodes/7']);
    expect(router.currentRoute.value.redirectedFrom?.fullPath).toBe('/nodes/7');
  });
});
