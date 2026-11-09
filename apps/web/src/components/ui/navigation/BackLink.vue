<template>
  <router-link v-if="target" v-slot="{ href }" :to="target.location" custom>
    <a
      :href="href"
      class="-ml-1.5 -mt-1.5 mb-3.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-inset hover:text-highlight"
      @click="onClick"
    >
      <icon-arrow-back class="size-4" />
      {{ target.label }}
    </a>
  </router-link>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import IconArrowBack from '~icons/material-symbols/arrow-back-rounded';

import { useGoBack } from '@/composables/useGoBack';

const { target, goBack } = useGoBack();

const onClick = (event: MouseEvent) => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return;
  }

  event.preventDefault();
  goBack();
};
</script>
