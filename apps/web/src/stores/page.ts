import { defineStore } from 'pinia';
import { reactive } from 'vue';

export interface IPage {
  title: string;
  subtitle?: string;
  back?: string;
  transient: boolean;
}

// Kept in memory only. An entry outlives its page, so a back link can label the page it leads to.
export const usePageStore = defineStore('page', () => {
  const pages = reactive(new Map<string, IPage>());

  function register(path: string, page: IPage) {
    pages.set(path, page);
  }

  function pageAt(path: string) {
    return pages.get(path);
  }

  return { register, pageAt };
});
