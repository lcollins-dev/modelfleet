<template>
  <component
    :is="props.to === undefined ? 'div' : UiLink"
    v-bind="props.to === undefined ? {} : { to: props.to, unstyled: true }"
    class="flex flex-wrap items-center gap-3.5 border-b border-divider py-3.5 pl-6 pr-4 last:border-b-0"
    :class="{ 'text-normal transition-colors duration-150 hover:bg-inset': props.to !== undefined }"
  >
    <span
      v-if="$slots.icon"
      class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-emphasis text-highlight"
    >
      <slot name="icon" />
    </span>

    <div class="min-w-48 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-medium text-header">
          <slot name="title">{{ props.title }}</slot>
        </span>
        <slot name="tags" />
      </div>
      <div v-if="props.meta || $slots.meta" class="mt-0.5 text-xs text-muted">
        <slot name="meta">{{ props.meta }}</slot>
      </div>
    </div>

    <slot name="actions" />
  </component>
</template>

<script setup lang="ts">
import UiLink from '../navigation/Link.vue';

const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  meta: {
    type: String,
    default: undefined,
  },
  to: {
    type: String,
    default: undefined,
  },
});
</script>
