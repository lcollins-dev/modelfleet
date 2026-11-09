import { NavigationGuardWithThis, RouteLocationNormalized, useRouter } from 'vue-router';

import { usePageStore } from '@/stores/page';

// Lets the failure log skip the aborts this guard causes to step back.
const steppedBack = new WeakSet<RouteLocationNormalized>();

export const isTransientStepBack = (to: RouteLocationNormalized) => steppedBack.has(to);

/** Keeps a transient page out of history: leaving it for the previous entry's path steps back, any other target replaces it. */
export const transientMiddleware: NavigationGuardWithThis<undefined> = (to, from) => {
  const router = useRouter();
  const pageStore = usePageStore();

  const historyState = router.options.history.state;

  // On popstate the browser has already moved, so `current` is the target. On an app push it is still the page left.
  const isAppNavigation = historyState.current === from.fullPath;

  // The replace returned below runs the guards again, so skip it to avoid a redirect loop.
  const isOwnRedirect = to.redirectedFrom !== undefined;

  if (pageStore.pageAt(from.path)?.transient !== true || !isAppNavigation || isOwnRedirect) {
    return true;
  }

  const back = historyState.back;

  if (typeof back === 'string' && router.resolve(back).path === to.path) {
    steppedBack.add(to);
    router.back();

    return false;
  }

  return { path: to.path, query: to.query, hash: to.hash, replace: true };
};
