<template>
  <div
    class="divide-y divide-divider overflow-hidden rounded-lg border border-divider"
    :class="props.emphasis ? 'bg-emphasis' : 'bg-inset'"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  emphasis: {
    type: Boolean,
    default: false,
  },
});
</script>
