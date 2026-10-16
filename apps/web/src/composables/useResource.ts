import { MaybeRefOrGetter, ref, shallowRef, toValue, watch } from 'vue';

import { useLogService } from '@/services/LogService';

export interface IResourceOptions<TRequest, TData> {
  /** A change refetches. A null request fetches nothing. */
  request: MaybeRefOrGetter<TRequest | null>;
  fetch: (request: TRequest) => Promise<TData>;
}

export const useResource = <TRequest, TData>(options: IResourceOptions<TRequest, TData>) => {
  const logService = useLogService();
  const logger = logService.createLogger('composables/useResource');

  const data = shallowRef<TData | null>(null);
  const loading = ref(false);

  let latestFetch = 0;

  // Lands the result only if no later fetch has started since. Settles with the fetch and never rejects.
  const reload = (): Promise<void> => {
    const request = toValue(options.request);

    if (request === null) {
      return Promise.resolve();
    }

    const fetchId = ++latestFetch;
    loading.value = true;

    return options
      .fetch(request)
      .then(result => {
        if (fetchId === latestFetch) {
          data.value = result;
        }
      })
      .finally(() => {
        if (fetchId === latestFetch) {
          loading.value = false;
        }
      })
      .catch((error: unknown) => {
        logger.error({ error }, 'reload(): Failed to fetch');
      });
  };

  watch(
    () => toValue(options.request),
    () => void reload(),
    { deep: true }
  );

  void reload();

  return { data, loading, reload };
};
