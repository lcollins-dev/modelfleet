<template>
  <span
    class="inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-xs leading-3"
    :class="TYPE_CLASSES[props.type]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

export type TagType = 'default' | 'primary' | 'success' | 'warning' | 'error';

const TYPE_CLASSES: Record<TagType, string> = {
  default: 'border-transparent bg-emphasis text-highlight',
  primary: 'border-transparent bg-primary-soft text-accent',
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning',
  error: 'border-transparent bg-error-soft text-error',
};

const props = defineProps({
  type: {
    type: String as PropType<TagType>,
    default: 'default',
  },
});
</script>
