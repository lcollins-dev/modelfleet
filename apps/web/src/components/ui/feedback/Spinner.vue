<template>
  <svg
    class="animate-spinner-turn"
    :class="props.type === 'primary' ? 'text-primary' : undefined"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 100 100"
    role="status"
    aria-label="Loading"
  >
    <circle
      class="origin-center animate-spinner-dash"
      cx="50"
      cy="50"
      r="43"
      fill="none"
      stroke="currentColor"
      stroke-width="14"
      stroke-linecap="round"
      stroke-dasharray="270"
      stroke-dashoffset="200"
    />
  </svg>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

type SpinnerType = 'primary' | 'current';

const props = defineProps({
  size: {
    type: Number,
    default: 28,
  },
  type: {
    type: String as PropType<SpinnerType>,
    default: 'primary',
  },
});
</script>
