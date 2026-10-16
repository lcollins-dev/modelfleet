<template>
  <div class="flex flex-col items-center gap-2.5 py-2 text-center">
    <span class="inline-flex size-12 items-center justify-center rounded-full" :class="TYPE_CLASSES[props.type]">
      <component :is="props.icon" class="size-6" />
    </span>

    <div class="mt-1 text-lg font-semibold text-header">{{ props.title }}</div>

    <p v-if="$slots.default" class="m-0 max-w-xs leading-normal text-normal"><slot /></p>

    <div v-if="$slots.actions" class="mt-2.5 flex gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Component, PropType } from 'vue';

type ResultType = 'success' | 'warning' | 'error' | 'primary' | 'muted';

const TYPE_CLASSES: Record<ResultType, string> = {
  success: 'bg-success/14 text-success',
  warning: 'bg-warning/14 text-warning',
  error: 'bg-error/14 text-error',
  primary: 'bg-primary-soft text-accent',
  muted: 'bg-muted/14 text-muted',
};

const props = defineProps({
  icon: {
    type: [Object, Function] as PropType<Component>,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  type: {
    type: String as PropType<ResultType>,
    default: 'muted',
  },
});
</script>
