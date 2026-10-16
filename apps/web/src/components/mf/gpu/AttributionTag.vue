<template>
  <span v-if="tag !== null" class="inline-flex cursor-help" :title="tag.note" data-testid="attribution-tag">
    <ui-tag type="warning">
      <icon-info class="-ml-0.5 mr-1 size-3.5" />

      {{ tag.label }}
    </ui-tag>
  </span>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconInfo from '~icons/material-symbols/info-outline-rounded';

import type { GpuTelemetryDto } from '@libs/dto';

import { attributionTag } from '@/utils/gpu';

import { UiTag } from '@/components/ui';

const props = defineProps({
  devices: {
    type: Array as PropType<GpuTelemetryDto[]>,
    required: true,
  },
});

const tag = computed(() => attributionTag(props.devices));
</script>
