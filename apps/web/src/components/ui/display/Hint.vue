<template>
  <span v-if="props.text !== undefined" :title="props.text" :class="[HINT_TARGET_CLASSES, HINT_UNDERLINE_CLASSES]">
    <slot />
  </span>

  <span v-else>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { HINT_TARGET_CLASSES, HINT_UNDERLINE_CLASSES } from './hint';

const props = defineProps({
  text: {
    type: String,
    default: undefined,
  },
});
</script>
