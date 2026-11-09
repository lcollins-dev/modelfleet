import { computed } from 'vue';
import { RouteLocationResolved, useRoute, useRouter } from 'vue-router';

import { useLogService } from '@/services/LogService';
import { usePageStore } from '@/stores/page';

export interface IBackTarget {
  location: RouteLocationResolved;
  label: string;
  throughHistory: boolean;
}

export interface IGoBackOptions {
  /** Replaces the current entry with the page's `back` route, so back never returns to an item that is gone. */
  replace?: boolean;
}

/** Leads back to the previous page when it is a page of the app, and to the page's `back` route otherwise. */
export const useGoBack = () => {
  const logService = useLogService();
  const logger = logService.createLogger('composables/useGoBack');

  const route = useRoute();
  const router = useRouter();
  const pageStore = usePageStore();

  const labelFor = (location: RouteLocationResolved) => {
    const title = pageStore.pageAt(location.path)?.title ?? '';

    return title === '' ? 'Back' : title;
  };

  const previousPage = () => {
    const back = router.options.history.state.back;

    if (typeof back !== 'string') {
      return null;
    }

    const previous = router.resolve(back);

    return pageStore.pageAt(previous.path) === undefined ? null : previous;
  };

  // History state is not reactive. The route dependency re-runs this after each navigation, once the entry has moved.
  const target = computed<IBackTarget | null>(() => {
    const back = pageStore.pageAt(route.path)?.back;

    if (back === undefined) {
      return null;
    }

    const previous = previousPage();

    if (previous !== null) {
      return { location: previous, label: labelFor(previous), throughHistory: true };
    }

    const backLocation = router.resolve(back);

    return { location: backLocation, label: labelFor(backLocation), throughHistory: false };
  });

  const replaceWithBackRoute = () => {
    const back = pageStore.pageAt(route.path)?.back;

    if (back === undefined) {
      logger.error({ path: route.path }, 'goBack(): The page has no back path to replace it with');
      return;
    }

    router.replace(router.resolve(back)).catch((error: unknown) => {
      logger.error({ error }, 'goBack(): Failed to replace the page with its back route');
    });
  };

  const goBack = (options: IGoBackOptions = {}) => {
    if (options.replace === true) {
      replaceWithBackRoute();
      return;
    }

    const current = target.value;

    if (current === null) {
      return;
    }

    if (current.throughHistory) {
      router.back();
      return;
    }

    router.push(current.location).catch((error: unknown) => {
      logger.error({ error }, 'goBack(): Failed to open the back route');
    });
  };

  return { target, goBack };
};
