<template>
  <span class="inline-flex items-center gap-2">
    <icon-logo class="select-none" aria-hidden="true" :width="logoSize" :height="logoSize" />

    <mf-wordmark :class="props.size === 'lg' ? 'text-xl' : 'text-base'" />
  </span>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconLogo from '~icons/modelfleet/logo';

import { MfWordmark } from '@/components/mf';

const props = defineProps({
  size: {
    type: String as PropType<'md' | 'lg'>,
    default: 'md',
  },
});

const logoSize = computed(() => (props.size === 'lg' ? 36 : 26));
</script>
