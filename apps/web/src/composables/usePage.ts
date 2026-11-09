import { MaybeRefOrGetter, toValue, watchEffect } from 'vue';
import { useRoute } from 'vue-router';

import { usePageStore } from '@/stores/page';

export interface IPageOptions {
  title: MaybeRefOrGetter<string>;
  subtitle?: MaybeRefOrGetter<string | undefined>;
  /** The path of the page above this one, such as `/deployments`. */
  back?: MaybeRefOrGetter<string | undefined>;
  transient?: boolean;
}

export const usePage = (options: IPageOptions) => {
  const route = useRoute();
  const pageStore = usePageStore();

  // Runs at once, so the entry exists before the heading renders. Follows the path, as a page stays mounted across params.
  watchEffect(() => {
    pageStore.register(route.path, {
      title: toValue(options.title),
      subtitle: toValue(options.subtitle),
      back: toValue(options.back),
      transient: options.transient ?? false,
    });
  });
};
