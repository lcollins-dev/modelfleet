<template>
  <ui-table-row :to="instanceTo" data-testid="instance-row">
    <div class="min-w-0">
      <div class="truncate font-mono font-medium text-header">{{ formatInstanceKey(props.instance.instanceKey) }}</div>

      <div v-if="failureTitle" class="mt-0.5 truncate text-xs text-error">{{ failureTitle }}</div>

      <div v-else-if="props.instance.state === InstanceState.STARTING" class="mt-0.5 truncate text-xs text-muted">
        Loading weights, waiting on its readiness probe
      </div>
    </div>

    <div class="min-w-0 truncate">
      <ui-link :to="party.to" class="relative z-2 max-w-full text-xs" data-testid="instance-party-link">
        <span class="truncate">{{ party.name }}</span>
      </ui-link>
    </div>

    <div>
      <ui-tag :type="instanceStateTone(props.instance.state)">{{ formatInstanceState(props.instance.state) }}</ui-tag>
    </div>

    <span class="truncate text-xs">{{ formatDevices(props.instance.devices) }}</span>

    <span class="text-xs">{{ formatUptime(props.instance.startedDate) ?? '-' }}</span>

    <span v-if="props.vramBytes !== undefined" class="font-mono text-xs">
      {{ props.vramBytes === null ? '-' : formatBytes(props.vramBytes) }}
    </span>

    <icon-chevron-right class="size-4 text-muted" />
  </ui-table-row>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { ListInstanceDto } from '@libs/dto';
import { InstanceState } from '@libs/dto';

import { formatBytes } from '@/utils/format/number';
import {
  formatDevices,
  formatInstanceFailure,
  formatInstanceKey,
  formatInstanceState,
  formatUptime,
  instanceStateTone,
} from '@/utils/instance';

import { UiLink, UiTableRow, UiTag } from '@/components/ui';

const props = defineProps({
  instance: {
    type: Object as PropType<ListInstanceDto>,
    required: true,
  },
  party: {
    type: String as PropType<'deployment' | 'node'>,
    required: true,
  },
  /** Undefined leaves the VRAM cell out, for a table without that column. */
  vramBytes: {
    type: Number as PropType<number | null>,
    default: undefined,
  },
});

const instanceTo = computed(() => `/deployments/${props.instance.deploymentId}/instance/${props.instance.instanceKey}`);

const party = computed(() =>
  props.party === 'deployment'
    ? { name: props.instance.deploymentName, to: `/deployments/${props.instance.deploymentId}` }
    : { name: props.instance.nodeName, to: `/nodes/${props.instance.nodeId}` }
);

const failureTitle = computed(() => formatInstanceFailure(props.instance));
</script>
