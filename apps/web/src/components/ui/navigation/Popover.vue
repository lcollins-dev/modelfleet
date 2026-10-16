<template>
  <div class="rounded-xl border border-divider bg-popover p-1">
    <div v-if="props.title" class="mb-1 border-b border-divider px-2.5 pb-2.5 pt-2">
      <div :id="titleId" class="font-medium text-header">{{ props.title }}</div>
      <div v-if="props.subtitle" class="text-xs text-muted">{{ props.subtitle }}</div>
    </div>

    <slot :title-id="props.title ? titleId : undefined" />
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';

const props = defineProps({
  title: {
    type: String,
    default: undefined,
  },
  subtitle: {
    type: String,
    default: undefined,
  },
});

const titleId = useId();
</script>
