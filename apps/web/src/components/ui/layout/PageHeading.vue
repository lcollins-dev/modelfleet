<template>
  <div class="mb-1">
    <ui-back-link />

    <div class="flex flex-wrap items-center gap-4">
      <slot name="leading" />

      <div class="min-w-0 flex-1">
        <h1 class="m-0 text-2xl font-semibold tracking-tight text-header">
          <slot name="title">{{ page?.title }}</slot>
        </h1>
        <p v-if="page?.subtitle || $slots.subtitle" class="mb-0 mt-1 text-muted">
          <slot name="subtitle">{{ page?.subtitle }}</slot>
        </p>
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { usePageStore } from '@/stores/page';

import UiBackLink from '../navigation/BackLink.vue';

const route = useRoute();
const pageStore = usePageStore();

const page = computed(() => pageStore.pageAt(route.path));
</script>
