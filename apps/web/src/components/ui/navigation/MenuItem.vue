<template>
  <component
    :is="props.interactive ? 'button' : 'div'"
    :type="props.interactive ? 'button' : undefined"
    class="flex w-full items-start gap-2.5 rounded-md bg-transparent px-2.5 py-2 text-left text-sm outline-hidden"
    :class="[
      props.danger ? 'text-error' : 'text-highlight',
      {
        'cursor-pointer': props.interactive,
        'hover:bg-inset focus-visible:bg-inset': props.interactive && props.hoverable,
      },
    ]"
  >
    <slot name="icon">
      <component
        :is="props.icon"
        v-if="props.icon"
        class="mt-0.5 size-4 shrink-0"
        :class="props.danger ? 'text-error' : 'text-muted'"
        aria-hidden="true"
      />
    </slot>

    <slot />
  </component>
</template>

<script setup lang="ts">
import { type Component, PropType } from 'vue';

const props = defineProps({
  icon: {
    type: [Object, Function] as PropType<Component>,
    default: undefined,
  },
  danger: {
    type: Boolean,
    default: false,
  },
  interactive: {
    type: Boolean,
    default: true,
  },
  // Off when a parent row paints the hover, so the fill also covers actions beside the item.
  hoverable: {
    type: Boolean,
    default: true,
  },
});
</script>
