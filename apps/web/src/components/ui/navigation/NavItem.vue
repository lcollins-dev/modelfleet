<template>
  <component
    :is="props.to === undefined ? 'button' : RouterLink"
    v-bind="props.to === undefined ? { type: 'button' } : { to: props.to }"
    class="my-px flex h-9 min-h-8 w-full shrink cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-hidden transition-colors duration-150"
    :class="
      props.active
        ? 'bg-emphasis text-header'
        : 'bg-transparent text-normal hover:bg-inset hover:text-header focus-visible:bg-inset'
    "
    :aria-current="props.active ? (props.to === undefined ? 'true' : 'page') : undefined"
  >
    <component :is="props.icon" v-if="props.icon" class="size-5 shrink-0" :class="iconClass" />

    <span class="min-w-0 flex-1 truncate" :class="{ 'text-error': props.error }">{{ props.label }}</span>

    <span v-if="$slots.count" class="flex shrink-0 items-center"><slot name="count" /></span>
  </component>
</template>

<script setup lang="ts">
import { type Component, computed, PropType } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps({
  to: {
    type: String,
    default: undefined,
  },
  label: {
    type: String,
    required: true,
  },
  icon: {
    type: [Object, Function] as PropType<Component>,
    default: undefined,
  },
  active: {
    type: Boolean,
    default: false,
  },

  /** Turns the icon and label red, on the active highlight too. */
  error: {
    type: Boolean,
    default: false,
  },
});

const iconClass = computed(() => {
  if (props.error) {
    return 'text-error';
  }

  return props.active ? 'text-accent' : 'text-muted';
});
</script>
