<template>
  <div>
    <div class="text-xs font-medium uppercase tracking-wider text-muted">{{ props.label }}</div>
    <div class="mt-1 text-highlight" :class="{ 'font-mono': props.mono }">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  mono: {
    type: Boolean,
    default: false,
  },
});
</script>
