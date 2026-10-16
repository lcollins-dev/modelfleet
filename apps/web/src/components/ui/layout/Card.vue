<template>
  <component
    :is="props.tag"
    class="flex flex-col overflow-hidden rounded-xl border bg-surface"
    :class="props.danger ? 'border-error-line' : 'border-divider'"
  >
    <div v-if="props.title" class="flex items-center justify-between gap-3 border-b border-divider px-6 py-4">
      <div class="min-w-0">
        <div class="text-base font-semibold text-header">{{ props.title }}</div>
        <div v-if="props.subtitle || $slots.subtitle" class="mt-0.5 text-xs leading-snug text-muted">
          <slot name="subtitle">{{ props.subtitle }}</slot>
        </div>
      </div>

      <slot name="header-extra" />
    </div>

    <div class="flex-auto" :class="bodyClass">
      <slot />
    </div>

    <div v-if="$slots.footer" class="flex justify-end border-t border-divider px-6 py-3">
      <slot name="footer" />
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  title: {
    type: String,
    default: undefined,
  },
  subtitle: {
    type: String,
    default: undefined,
  },
  tag: {
    type: String,
    default: 'div',
  },
  flush: {
    type: Boolean,
    default: false,
  },
  rows: {
    type: Boolean,
    default: false,
  },
  danger: {
    type: Boolean,
    default: false,
  },
});

const bodyClass = computed(() => {
  if (props.flush) {
    return '';
  }

  return props.rows ? 'px-6 [&>*+*]:border-t [&>*+*]:border-divider' : 'px-6 py-5';
});
</script>
