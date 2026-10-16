<template>
  <img
    class="shrink-0 select-none rounded-md"
    src="/favicon.png"
    alt=""
    :width="props.size"
    :height="props.size"
    :style="{ width: `${props.size}px`, height: `${props.size}px` }"
  />
</template>

<script setup lang="ts">
const props = defineProps({
  size: {
    type: Number,
    default: 28,
  },
});
</script>
