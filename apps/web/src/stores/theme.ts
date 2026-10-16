import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, watch } from 'vue';

export type ThemeName = 'dark' | 'light';

export const useThemeStore = defineStore('theme', () => {
  // index.html reads this key to set the theme before the app loads.
  const isDarkMode = useLocalStorage<boolean>('isDarkMode', () => true);

  const themeName = computed<ThemeName>(() => (isDarkMode.value ? 'dark' : 'light'));

  watch(
    themeName,
    name => {
      document.documentElement.dataset.theme = name;
    },
    { immediate: true, flush: 'sync' }
  );

  function toggleDarkMode(): void {
    isDarkMode.value = !isDarkMode.value;
  }

  return {
    isDarkMode,
    themeName,
    toggleDarkMode,
  };
});
