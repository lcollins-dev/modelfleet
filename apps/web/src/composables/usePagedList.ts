import { MaybeRefOrGetter, onBeforeUnmount, onMounted, ref, shallowRef, toValue, watch } from 'vue';

import type { EventDto } from '@libs/dto';
import { EventPartyType } from '@libs/dto';

import { Config } from '@/Config';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';

export interface IListPage<TItem> {
  list: TItem[];
  pages: number;
}

export interface IPagedListOptions<TRequest, TItem> {
  /** A change returns the list to its first page. A null request fetches nothing. */
  request: MaybeRefOrGetter<TRequest | null>;
  fetch: (request: TRequest, page: number) => Promise<IListPage<TItem>>;
  /** Set false for a request that changes on navigation rather than typing, so it fetches at once. */
  debounceRequest?: boolean;
  /** Refetches when an event about one of these arrives, and whenever the event stream reconnects. */
  liveSubjects?: EventPartyType[];
  onLive?: () => void;
}

export const usePagedList = <TRequest, TItem>(options: IPagedListOptions<TRequest, TItem>) => {
  const logService = useLogService();
  const logger = logService.createLogger('composables/usePagedList');

  const eventAdminService = useEventAdminService();

  const list = shallowRef<TItem[]>([]);
  const page = ref(1);
  const pages = ref(1);
  const loading = ref(false);

  const subscription = shallowRef<ISseSubscription | null>(null);

  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let latestLoad = 0;
  // Bumped by each request or page change; the loader shows only while the rows on screen answer an older one.
  let listVersion = 0;
  let shownVersion = -1;

  const cancelRefresh = () => {
    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
  };

  // A response lands only if no later load has started since. Settles with the fetch and never rejects.
  const load = (): Promise<void> => {
    cancelRefresh();

    const request = toValue(options.request);

    if (request === null) {
      return Promise.resolve();
    }

    const loadId = ++latestLoad;
    const loadVersion = listVersion;

    if (shownVersion !== loadVersion) {
      loading.value = true;
    }

    return options
      .fetch(request, page.value)
      .then(result => {
        if (loadId !== latestLoad) {
          return;
        }

        list.value = result.list;
        pages.value = result.pages;
        shownVersion = loadVersion;
      })
      .finally(() => {
        if (loadId === latestLoad) {
          loading.value = false;
        }
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'load(): Failed to get the list');
      });
  };

  const refresh = () => {
    cancelRefresh();

    refreshTimer = setTimeout(() => void load(), Config.LIST_DEBOUNCE_MS);
  };

  const onReconnect = () => {
    void load();
    options.onLive?.();
  };

  const onLiveEvent = (event: EventDto) => {
    if (event.subjectType === undefined || !options.liveSubjects?.includes(event.subjectType)) {
      return;
    }

    refresh();
    options.onLive?.();
  };

  watch(
    () => toValue(options.request),
    () => {
      listVersion++;

      if (options.debounceRequest === false && page.value === 1) {
        void load();

        return;
      }

      if (options.debounceRequest !== false) {
        refresh();
      }

      page.value = 1;
    },
    { deep: true }
  );

  // A reset to page 1 during a pending refresh leaves the fetch to that refresh.
  watch(page, newPage => {
    listVersion++;

    if (newPage === 1 && refreshTimer !== null) {
      return;
    }

    void load();
  });

  onMounted(() => {
    void load();

    if (options.liveSubjects !== undefined) {
      subscription.value = eventAdminService.streamEvents(onLiveEvent, onReconnect);
    }
  });

  onBeforeUnmount(() => {
    cancelRefresh();
    subscription.value?.close();
  });

  return { list, page, pages, loading, load, refresh };
};
