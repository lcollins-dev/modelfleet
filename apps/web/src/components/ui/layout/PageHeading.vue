<template>
  <div class="mb-1">
    <ui-back-link v-if="props.backTo" :to="props.backTo" :label="props.backLabel ?? ''" :on-back="props.onBack" />

    <div class="flex flex-wrap items-center gap-4">
      <slot name="leading" />

      <div class="min-w-0 flex-1">
        <h1 class="m-0 text-2xl font-semibold tracking-tight text-header">
          <slot name="title">{{ props.title }}</slot>
        </h1>
        <p v-if="props.subtitle || $slots.subtitle" class="mb-0 mt-1 text-muted">
          <slot name="subtitle">{{ props.subtitle }}</slot>
        </p>
      </div>

      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import UiBackLink from '../navigation/BackLink.vue';

const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  subtitle: {
    type: String,
    default: undefined,
  },
  backTo: {
    type: String,
    default: undefined,
  },
  backLabel: {
    type: String,
    default: undefined,
  },
  onBack: {
    type: Function as PropType<() => void>,
    default: undefined,
  },
});
</script>
