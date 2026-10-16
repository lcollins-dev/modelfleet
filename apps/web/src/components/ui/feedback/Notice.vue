<template>
  <div class="relative rounded-xl border py-2.5 pl-10 pr-3 text-sm" :class="TYPE_CLASSES[props.type]" role="alert">
    <ui-disc-icon
      :icon="SEVERITY_ICONS[props.type]"
      :size="20"
      class="absolute left-3 top-2.5 text-surface"
      :class="props.type === 'info' ? 'bg-accent' : SEVERITY_DISC_CLASSES[props.type]"
    />

    <div v-if="props.title" class="mb-0.5 font-medium text-header">{{ props.title }}</div>

    <div class="text-normal">
      <slot />
    </div>

    <div v-if="$slots.action" class="mt-3 flex justify-end">
      <slot name="action" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import UiDiscIcon from '../display/DiscIcon.vue';
import { Severity, SEVERITY_DISC_CLASSES, SEVERITY_ICONS } from './severity';

const TYPE_CLASSES: Record<Severity, string> = {
  info: 'border-transparent bg-primary-soft',
  success: 'border-transparent bg-success-soft',
  warning: 'border-transparent bg-warning-soft',
  error: 'border-error-line bg-error-soft',
};

const props = defineProps({
  type: {
    type: String as PropType<Severity>,
    default: 'info',
  },
  title: {
    type: String,
    default: undefined,
  },
});
</script>
