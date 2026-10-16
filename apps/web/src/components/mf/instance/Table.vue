<template>
  <ui-table :columns="gridColumns" :min-width="680">
    <ui-table-head>
      <span>Instance</span>
      <span>{{ props.party === 'deployment' ? 'Deployment' : 'Node' }}</span>
      <span>State</span>
      <span>Device</span>
      <span>Uptime</span>
      <span v-if="props.vramByInstance !== undefined">VRAM</span>
      <span></span>
    </ui-table-head>

    <mf-instance-row
      v-for="instance of props.instances"
      :key="instance.instanceKey"
      :instance="instance"
      :party="props.party"
      :vram-bytes="vramOf(instance)"
    />

    <template v-if="!props.loading && props.instances.length === 0" #empty>{{ props.emptyDescription }}</template>
  </ui-table>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';

import type { ListInstanceDto } from '@libs/dto';

import { UiTable, UiTableHead } from '@/components/ui';

import MfInstanceRow from './Row.vue';

const props = defineProps({
  instances: {
    type: Array as PropType<ListInstanceDto[]>,
    required: true,
  },

  /** Names whichever party the screen is not already about. */
  party: {
    type: String as PropType<'deployment' | 'node'>,
    required: true,
  },
  emptyDescription: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },

  /** Given, a VRAM column reads each instance's memory from it, and `-` for one it lacks. */
  vramByInstance: {
    type: Object as PropType<Record<string, number>>,
    default: undefined,
  },
});

const gridColumns = computed(() =>
  [
    'minmax(0, 1fr)',
    'minmax(0, 1fr)',
    '6rem',
    'minmax(0, 10rem)',
    '6rem',
    ...(props.vramByInstance === undefined ? [] : ['5.5rem']),
    '1rem',
  ].join(' ')
);

const vramOf = (instance: ListInstanceDto): number | null | undefined =>
  props.vramByInstance === undefined ? undefined : (props.vramByInstance[instance.instanceKey] ?? null);
</script>
