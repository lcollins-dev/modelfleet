<template>
  <div class="flex min-h-screen flex-col items-center gap-6 px-4 pb-6 pt-16">
    <app-logo size="lg" />

    <div class="w-full" :class="route.meta.wideLayout === true ? 'max-w-160' : 'max-w-sm'">
      <slot />
    </div>

    <app-footer class="mt-auto" />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

import AppFooter from '@/components/shell/AppFooter.vue';
import AppLogo from '@/components/shell/AppLogo.vue';

const route = useRoute();
</script>
