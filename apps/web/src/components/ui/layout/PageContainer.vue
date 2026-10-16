<template>
  <div class="mx-auto flex flex-col gap-4" :class="props.wide ? 'max-w-5xl' : 'max-w-4xl'">
    <slot />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  wide: {
    type: Boolean,
    default: false,
  },
});
</script>
