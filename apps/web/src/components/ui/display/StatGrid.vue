<template>
  <div class="grid grid-cols-1 gap-x-6 gap-y-4" :class="props.columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

const props = defineProps({
  columns: {
    type: Number as PropType<2 | 3>,
    default: 3,
  },
});
</script>
