<template>
  <div class="grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 bg-inset px-4 py-3 text-xs">
    <template v-for="[key, value] of Object.entries(props.detail)" :key="key">
      <span class="text-muted">{{ key }}</span>

      <span class="wrap-break-word font-mono text-highlight">{{ value }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import type { EventDetail } from '@libs/dto';

const props = defineProps({
  detail: {
    type: Object as PropType<EventDetail>,
    required: true,
  },
});
</script>
