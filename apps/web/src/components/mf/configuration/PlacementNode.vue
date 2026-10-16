<template>
  <div data-testid="placement-node">
    <ui-picker-row
      v-model:expanded="open"
      :label="props.node.name"
      :checked="nodeChecked"
      :indeterminate="nodeIndeterminate"
      mono
      @update:checked="toggleNode"
    >
      <template #description>{{ nodeSummary }}</template>

      <template #aside>
        <ui-tag v-if="fit !== null" :type="placementFitTone(fit)">{{ formatPlacementFit(fit) }}</ui-tag>
      </template>

      <template #actions>
        <ui-icon-button
          :icon="open ? IconExpandLess : IconExpandMore"
          :label="open ? 'Hide devices' : 'Show devices'"
          :aria-expanded="open"
          @click="open = !open"
        />
      </template>
    </ui-picker-row>

    <div v-if="fitLines.length > 0" class="flex flex-col pb-2.5 pl-10 pr-4 text-xs text-muted">
      <span v-for="line of fitLines" :key="line">{{ line }}.</span>
    </div>

    <div v-if="open" class="border-t border-divider bg-inset [&>*+*]:border-t [&>*+*]:border-divider">
      <ui-picker-row label="CPU" :checked="onCpu" nested @update:checked="toggleCpu">
        <template #description>{{ cpuSummary }}</template>
      </ui-picker-row>

      <ui-picker-row
        v-for="device of props.node.devices"
        :key="device.deviceKey"
        :label="device.name ?? 'Unnamed device'"
        :checked="isPinned(device.deviceKey)"
        nested
        @update:checked="toggleDevice(device.deviceKey)"
      >
        <template #description>
          <span class="block truncate font-mono">{{ device.deviceKey }}</span>
        </template>

        <template #aside>
          <span class="whitespace-nowrap font-mono text-xs text-normal">{{ describeFree(device) }}</span>
        </template>
      </ui-picker-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import IconExpandLess from '~icons/material-symbols/expand-less-rounded';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';

import type { GpuTelemetryDto, PlacementNodeDto } from '@libs/dto';
import { NodeState } from '@libs/dto';

import type { IPinRules, IPinnableNode, IPlacementSelection } from '@/utils/configuration/placement';
import {
  describePins,
  isCpuPinned,
  isDevicePinned,
  isNodePartlyPinned,
  isNodePinned,
  toggleCpuPin,
  toggleDevicePin,
  toggleNodePin,
} from '@/utils/configuration/placement';
import { describePlacementFit, formatPlacementFit, placementFit, placementFitTone } from '@/utils/deployment';
import { formatBytes, formatCount } from '@/utils/format/number';
import { capacityShares, cardFigures } from '@/utils/gpu';

import { UiIconButton, UiPickerRow, UiTag } from '@/components/ui';

const props = defineProps<{
  node: IPinnableNode;

  /** Null while nothing on the node is ticked, or before its preview has arrived. */
  verdict: PlacementNodeDto | null;

  rules: IPinRules;
}>();

const selection = defineModel<IPlacementSelection>({ required: true });

const open = ref(false);

const deviceKeys = computed(() => props.node.devices.map(device => device.deviceKey));

const nodeChecked = computed(() => isNodePinned(selection.value, props.node.id, deviceKeys.value));

const nodeIndeterminate = computed(() => isNodePartlyPinned(selection.value, props.node.id, deviceKeys.value));

const onCpu = computed(() => isCpuPinned(selection.value, props.node.id));

const nodeSummary = computed(() => {
  const count = props.node.devices.length;
  const hardware = count === 0 ? 'CPU only' : `CPU, ${formatCount(count, 'GPU')}`;
  const state = props.node.state === NodeState.ONLINE ? hardware : `${hardware} · ${props.node.state}`;
  const pinned = describePins(selection.value, props.node.id, deviceKeys.value);

  return pinned.length === 0 ? state : `${state} · ${pinned} pinned`;
});

const cpuSummary = computed(() =>
  deviceKeys.value.some(deviceKey => isPinned(deviceKey))
    ? "The host's own cores, taking layers the GPUs cannot hold."
    : "The host's own cores, taking no GPU. Needs a CPU build of the image."
);

const fit = computed(() => (props.verdict === null ? null : placementFit(props.verdict)));

const fitLines = computed(() => (props.verdict === null ? [] : describePlacementFit(props.verdict)));

const isPinned = (deviceKey: string): boolean => isDevicePinned(selection.value, props.node.id, deviceKey);

/** Prefers the verdict's figures for a card, since the verdict was read off them. */
const describeFree = (device: GpuTelemetryDto): string => {
  const checked = props.verdict?.capacity?.cards.find(card => card.deviceKey === device.deviceKey);
  const available = capacityShares(checked ?? cardFigures(device, props.node.headroomBytes))?.availableBytes ?? null;

  return available === null ? 'free not reported' : `${formatBytes(available)} free after headroom`;
};

const toggleCpu = (checked: boolean) => {
  selection.value = toggleCpuPin(selection.value, props.node.id, checked, props.rules);
};

const toggleDevice = (deviceKey: string) => {
  selection.value = toggleDevicePin(selection.value, props.node.id, deviceKey, props.rules);
};

const toggleNode = (checked: boolean) => {
  selection.value = toggleNodePin(selection.value, props.node.id, deviceKeys.value, checked, props.rules);
};
</script>
