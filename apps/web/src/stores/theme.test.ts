import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useThemeStore } from './theme';

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('starts in dark mode', () => {
    const themeStore = useThemeStore();

    expect(themeStore.isDarkMode).toBe(true);
    expect(themeStore.themeName).toBe('dark');
  });

  it('restores the mode chosen in a previous session', () => {
    window.localStorage.setItem('isDarkMode', 'false');

    const themeStore = useThemeStore();

    expect(themeStore.isDarkMode).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('flips the mode on toggle', () => {
    const themeStore = useThemeStore();

    themeStore.toggleDarkMode();

    expect(themeStore.isDarkMode).toBe(false);

    themeStore.toggleDarkMode();

    expect(themeStore.isDarkMode).toBe(true);
  });

  it('persists the mode to local storage', async () => {
    const themeStore = useThemeStore();

    themeStore.toggleDarkMode();
    await nextTick();

    expect(window.localStorage.getItem('isDarkMode')).toBe('false');
  });

  it('sets the theme on the root element', () => {
    const themeStore = useThemeStore();

    expect(document.documentElement.dataset.theme).toBe('dark');

    themeStore.toggleDarkMode();

    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
