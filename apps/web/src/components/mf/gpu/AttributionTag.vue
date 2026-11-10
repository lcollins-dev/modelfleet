<template>
  <ui-tag v-if="tag !== null" type="warning" :hint="tag.note" data-testid="attribution-tag">
    {{ tag.label }}
  </ui-tag>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';

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
