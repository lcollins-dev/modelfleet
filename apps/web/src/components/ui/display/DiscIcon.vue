<template>
  <span
    class="inline-flex shrink-0 items-center justify-center rounded-full"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
    aria-hidden="true"
  >
    <component :is="props.icon" :style="{ width: `${props.iconSize}px`, height: `${props.iconSize}px` }" />
  </span>
</template>

<script setup lang="ts">
import { type Component, PropType } from 'vue';

// The caller colours the disc with a `bg-` class and the glyph with a `text-` class.
const props = defineProps({
  icon: {
    type: [Object, Function] as PropType<Component>,
    required: true,
  },
  size: {
    type: Number,
    required: true,
  },
  iconSize: {
    type: Number,
    default: 16,
  },
});
</script>
