import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteLocationNormalized, createMemoryHistory, createRouter } from 'vue-router';

import { logNavigationFailure } from './log';

const warn = vi.hoisted(() => vi.fn());
const isTransientStepBack = vi.hoisted(() => vi.fn(() => false));

vi.mock('@/services/LogService', () => ({
  useLogService: () => ({ createLogger: () => ({ info: vi.fn(), warn }) }),
}));

vi.mock('./transient', () => ({ isTransientStepBack }));

const createTestRouter = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });

  router.afterEach(logNavigationFailure);

  return router;
};

describe('logNavigationFailure', () => {
  beforeEach(() => {
    warn.mockClear();
    isTransientStepBack.mockReset();
    isTransientStepBack.mockReturnValue(false);
  });

  it('logs a navigation a guard aborts, with where it was going and coming from', async () => {
    const router = createTestRouter();
    await router.push('/nodes');

    router.beforeEach(() => false);
    await router.push('/models');

    expect(warn).toHaveBeenCalledWith(
      { to: '/models', from: '/nodes', type: 'aborted' },
      'logNavigationFailure(): Navigation did not complete'
    );
  });

  it('logs a navigation a later one cancels', async () => {
    const router = createTestRouter();
    await router.push('/nodes');

    let release = () => {};
    router.beforeEach(to => (to.path === '/models' ? new Promise<void>(resolve => (release = resolve)) : undefined));

    const cancelled = router.push('/models');
    await router.push('/presets');
    release();
    await cancelled;

    expect(warn).toHaveBeenCalledWith(
      { to: '/models', from: '/nodes', type: 'cancelled' },
      'logNavigationFailure(): Navigation did not complete'
    );
  });

  it('stays quiet on the abort a transient page makes to step back', async () => {
    const router = createTestRouter();
    await router.push('/nodes');

    isTransientStepBack.mockReturnValue(true);
    router.beforeEach(() => false);
    await router.push('/models');

    expect(warn).not.toHaveBeenCalled();
  });

  it('logs any other failure of a navigation marked as a step back', async () => {
    const router = createTestRouter();
    await router.push('/nodes');

    isTransientStepBack.mockReturnValue(true);

    let release = () => {};
    router.beforeEach(to => (to.path === '/models' ? new Promise<void>(resolve => (release = resolve)) : undefined));

    const cancelled = router.push('/models');
    await router.push('/presets');
    release();
    await cancelled;

    expect(warn).toHaveBeenCalledWith(
      { to: '/models', from: '/nodes', type: 'cancelled' },
      'logNavigationFailure(): Navigation did not complete'
    );
  });

  it('stays quiet on a navigation that completes', () => {
    const route = { fullPath: '/nodes' } as RouteLocationNormalized;

    logNavigationFailure(route, route, undefined);

    expect(warn).not.toHaveBeenCalled();
  });
});
