<template>
  <span
    v-if="props.count > 0"
    class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold leading-none text-on-primary"
  >
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  count: {
    type: Number,
    required: true,
  },
  max: {
    type: Number,
    default: 99,
  },
});

const label = computed(() => (props.count > props.max ? `${props.max}+` : String(props.count)));
</script>
