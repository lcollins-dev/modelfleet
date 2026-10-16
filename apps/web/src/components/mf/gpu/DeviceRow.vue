<template>
  <ui-list-row>
    <template #icon>
      <icon-memory class="size-5" />
    </template>

    <template #title>{{ indexLabel }} · {{ gpuName(props.device) }}</template>

    <template v-if="attribution !== null" #tags>
      <ui-tag type="warning" :title="attribution.note">Unattributed</ui-tag>
    </template>

    <template #meta>
      <span class="block truncate font-mono" :title="deviceLabel">{{ telemetryLabel }} · {{ deviceLabel }}</span>
    </template>

    <template #actions>
      <mf-gpu-vram-bar
        class="min-w-70"
        :devices="[props.device]"
        :headroom-bytes="props.headroomBytes"
        legend
        processes
      />
    </template>
  </ui-list-row>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconMemory from '~icons/material-symbols/memory-outline-rounded';

import type { GpuTelemetryDto } from '@libs/dto';

import { attributionTag, gpuName } from '@/utils/gpu';

import { UiListRow, UiTag } from '@/components/ui';

import MfGpuVramBar from './VramBar.vue';

const props = defineProps({
  device: {
    type: Object as PropType<GpuTelemetryDto>,
    required: true,
  },
  headroomBytes: {
    type: Number as PropType<number | null>,
    default: null,
  },
});

const indexLabel = computed(() => (props.device.index === null ? 'GPU' : `GPU ${props.device.index}`));

const deviceLabel = computed(() => props.device.pciBusId ?? props.device.deviceKey);

const attribution = computed(() => attributionTag([props.device]));

const telemetryLabel = computed(() => {
  const device = props.device;
  const utilisation = device.utilisationPercent === null ? '-' : `${device.utilisationPercent}% util`;
  const temperature = device.temperatureC === null ? '-' : `${device.temperatureC} °C`;
  const power = device.powerDrawWatts === null ? '-' : `${device.powerDrawWatts} W`;

  return `${utilisation} · ${temperature} · ${power}`;
});
</script>
