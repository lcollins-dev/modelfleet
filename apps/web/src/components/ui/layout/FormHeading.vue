<template>
  <div>
    <h1 class="m-0 text-xl font-semibold tracking-tight text-header">{{ props.title }}</h1>
    <p v-if="props.subtitle || $slots.subtitle" class="mb-6 mt-1.5 leading-normal text-muted">
      <slot name="subtitle">{{ props.subtitle }}</slot>
    </p>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  subtitle: {
    type: String,
    default: undefined,
  },
});
</script>
