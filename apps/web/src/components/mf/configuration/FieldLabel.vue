<template>
  <span class="inline-flex flex-wrap items-center gap-2">
    {{ label }}

    <ui-tag v-if="overridden" type="primary">Overridden</ui-tag>

    <ui-tag v-else-if="fromPreset">From preset</ui-tag>
  </span>
</template>

<script setup lang="ts">
import { UiTag } from '@/components/ui';

withDefaults(
  defineProps<{
    label: string;
    overridden?: boolean;
    fromPreset?: boolean;
  }>(),
  { overridden: false, fromPreset: false }
);
</script>
