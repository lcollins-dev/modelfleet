<template>
  <mf-meter
    class="flex-1"
    :label="usedLabel"
    :detail="freeLabel"
    :bands="bands"
    :legend="props.legend"
    :overflow-value="overflowValue"
  />
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';

import type { GpuProcessDto, GpuTelemetryDto } from '@libs/dto';

import { formatBytes } from '@/utils/format/number';
import { pooledCapacity, processLabel, vramUsage } from '@/utils/gpu';

import MfMeter, { IMeterBand } from '../Meter.vue';
import { MeterTone, PROCESS_METER_TONES } from '../meterTone';

const props = defineProps({
  devices: {
    type: Array as PropType<GpuTelemetryDto[]>,
    required: true,
  },
  legend: {
    type: Boolean,
    default: false,
  },
  processes: {
    type: Boolean,
    default: false,
  },

  /** The node's headroom. Given, the bar adds headroom and what is starting, and free is after both. */
  headroomBytes: {
    type: Number as PropType<number | null>,
    default: null,
  },
});

const usage = computed(() => vramUsage(props.devices));

const measured = computed(() => usage.value.totalBytes > 0);

const withCapacity = computed(() => props.headroomBytes !== null);

const pooled = computed(() => pooledCapacity(props.devices, props.headroomBytes ?? 0));

const freeBytes = computed(() => (withCapacity.value ? pooled.value.availableBytes : usage.value.freeBytes));

const overflowValue = computed(() =>
  withCapacity.value && pooled.value.overBytes > 0 ? formatBytes(pooled.value.overBytes) : null
);

const usedLabel = computed(() => {
  if (measured.value) {
    return `${formatBytes(usage.value.usedBytes)} of ${formatBytes(usage.value.totalBytes)}`;
  }

  const reportedTotal = props.devices.reduce((sum, device) => sum + (device.memoryTotalBytes ?? 0), 0);

  return reportedTotal === 0 ? 'Memory not reported' : `${formatBytes(reportedTotal)} total`;
});

const freeLabel = computed(() => (props.legend && measured.value ? `${formatBytes(freeBytes.value)} free` : undefined));

const heldBy = computed(() =>
  props.devices
    .filter(device => device.memoryUsedBytes !== null && device.memoryTotalBytes !== null)
    .flatMap(device => device.processes)
);

const percentOf = (bytes: number): number => (measured.value ? (bytes / usage.value.totalBytes) * 100 : 0);

const bandOf = (label: string, tone: MeterTone, bytes: number): IMeterBand => ({
  label,
  tone,
  value: measured.value ? formatBytes(bytes) : '-',
  percent: percentOf(bytes),
});

const foldByLabel = (
  processes: GpuProcessDto[],
  labelOf: (process: GpuProcessDto) => string
): Map<string, number | null> => {
  const held = new Map<string, number | null>();

  for (const process of processes) {
    const label = labelOf(process);
    const heldBytes = held.get(label) ?? null;

    held.set(label, process.usedBytes === null ? heldBytes : (heldBytes ?? 0) + process.usedBytes);
  }

  return held;
};

const deployments = computed(() =>
  foldByLabel(
    heldBy.value.filter(process => process.instanceKey !== null),
    process => process.deploymentName ?? processLabel(process)
  )
);

const outsideProcessList = computed(() => {
  const outside = foldByLabel(
    heldBy.value.filter(process => process.instanceKey === null),
    processLabel
  );

  if (outside.size === 0) {
    return undefined;
  }

  return [...outside]
    .sort(([, leftBytes], [, rightBytes]) => (rightBytes ?? -1) - (leftBytes ?? -1))
    .map(([label, bytes]) => `${label} ${bytes === null ? 'unknown' : formatBytes(bytes)}`)
    .join(', ');
});

const deploymentBand = (label: string, bytes: number | null, index: number): IMeterBand => {
  const tone = PROCESS_METER_TONES[index % PROCESS_METER_TONES.length];

  return bytes === null ? { label, tone, value: 'Unknown', percent: 0 } : bandOf(label, tone, bytes);
};

const processBands = computed<IMeterBand[]>(() => {
  const deploymentBytes = [...deployments.value.values()].reduce<number>((sum, bytes) => sum + (bytes ?? 0), 0);
  const otherBytes = Math.max(0, usage.value.usedBytes - deploymentBytes);

  const bands = [...deployments.value].map(([label, bytes], index) => deploymentBand(label, bytes, index));

  if (otherBytes === 0 && outsideProcessList.value === undefined) {
    return bands;
  }

  return [...bands, { ...bandOf('Other', 'muted', otherBytes), hoverNote: outsideProcessList.value }];
});

const headroomBand = computed<IMeterBand[]>(() =>
  withCapacity.value ? [bandOf('Headroom', 'strong', pooled.value.headroomBytes)] : []
);

const startingBands = computed<IMeterBand[]>(() =>
  withCapacity.value
    ? pooled.value.starting.map(share =>
        bandOf(
          share.deploymentName === null ? 'Starting' : `${share.deploymentName} (starting)`,
          'pending',
          share.bytes
        )
      )
    : []
);

const bands = computed<IMeterBand[]>(() => {
  const inUse = props.processes ? processBands.value : [bandOf('In use', 'primary', usage.value.usedBytes)];

  return [...headroomBand.value, ...inUse, ...startingBands.value];
});
</script>
