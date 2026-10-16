<template>
  <ui-icon-button
    :icon="themeStore.isDarkMode ? IconDarkMode : IconLightMode"
    label="Toggle theme"
    @click="themeStore.toggleDarkMode"
  />
</template>

<script setup lang="ts">
import IconDarkMode from '~icons/material-symbols/dark-mode-outline-rounded';
import IconLightMode from '~icons/material-symbols/light-mode-outline-rounded';

import { useThemeStore } from '@/stores/theme';

import { UiIconButton } from '@/components/ui';

const themeStore = useThemeStore();
</script>
