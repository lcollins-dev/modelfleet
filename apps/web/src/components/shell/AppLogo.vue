<template>
  <span class="inline-flex items-center gap-2">
    <mf-logo :size="props.size === 'lg' ? 36 : 26" />

    <mf-wordmark :class="props.size === 'lg' ? 'text-xl' : 'text-base'" />
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import { MfLogo, MfWordmark } from '@/components/mf';

const props = defineProps({
  size: {
    type: String as PropType<'md' | 'lg'>,
    default: 'md',
  },
});
</script>
