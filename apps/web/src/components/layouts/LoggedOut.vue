<template>
  <app-shell>
    <template #actions>
      <theme-toggle />
    </template>

    <slot />
  </app-shell>
</template>

<script setup lang="ts">
import AppShell from '@/components/shell/AppShell.vue';
import ThemeToggle from '@/components/shell/ThemeToggle.vue';
</script>
