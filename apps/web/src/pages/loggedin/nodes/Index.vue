<template>
  <ui-page-container wide>
    <ui-page-heading title="Nodes" subtitle="Machines running the Modelfleet agent.">
      <ui-button type="primary" to="/nodes/register">
        <template #icon>
          <icon-add class="size-4" />
        </template>
        Register Node
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="stateFilter"
        placeholder="Search nodes"
        :segments="STATE_FILTERS"
      />

      <ui-table :columns="TABLE_COLUMNS" :min-width="900">
        <ui-table-head>
          <span>Node</span>
          <span>State</span>
          <span>GPUs</span>
          <span>Instances</span>
          <span>Heartbeat</span>
          <span>VRAM</span>
          <span></span>
        </ui-table-head>

        <ui-table-row v-for="node of nodeList" :key="node.id" :to="`/nodes/${node.id}`" data-testid="node-row">
          <div class="min-w-0">
            <div class="truncate font-mono font-medium text-header">{{ node.name }}</div>
            <div v-if="node.agentVersion" class="mt-0.5 truncate font-mono text-xs text-muted">
              agent {{ node.agentVersion }}
            </div>
          </div>

          <div>
            <ui-tag :type="nodeStateTone(node.state)">{{ formatNodeState(node.state) }}</ui-tag>
          </div>

          <span class="font-mono text-xs">{{ gpuCount(node) }}</span>

          <span class="font-mono text-xs">{{ instanceCount(node) }}</span>

          <span class="text-xs">{{
            node.lastSeenDate === null ? 'Never' : formatRelativeDate(node.lastSeenDate)
          }}</span>

          <mf-gpu-vram-bar
            v-if="hasVram(node)"
            :devices="devicesOf(node)"
            :headroom-bytes="fleetNodes.get(node.id)?.status.headroomBytes"
            processes
          />

          <span v-else class="text-right text-xs text-muted">-</span>

          <icon-chevron-right class="size-4 text-muted" />
        </ui-table-row>

        <template v-if="!loading && nodeList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="node-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type {
  FleetNodeTelemetryDto,
  FleetTelemetryResponseDto,
  GpuTelemetryDto,
  ListInstanceDto,
  ListNodeDto,
  NodeListRequestDto,
} from '@libs/dto';
import { EventPartyType, NodeState } from '@libs/dto';

import { Config } from '@/Config';

import { formatRelativeDate } from '@/utils/format/date';
import { vramUsage } from '@/utils/gpu';
import { formatNodeState, nodeStateTone } from '@/utils/node';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useNodeAdminService } from '@/services/api/admin/NodeAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';

import { MfFilterToolbar, MfGpuVramBar } from '@/components/mf';
import {
  ISegmentedControlOption,
  UiButton,
  UiCard,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

type StateFilter = 'all' | 'online' | 'offline' | 'inactive';

const TABLE_COLUMNS = 'minmax(0, 1fr) 10rem 3.5rem 4.5rem 7rem 11rem 1rem';

const STATE_FILTERS: ISegmentedControlOption<StateFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'inactive', label: 'Inactive' },
];

const FILTER_STATES: Record<StateFilter, NodeState[] | undefined> = {
  all: undefined,
  online: [NodeState.ONLINE],
  offline: [NodeState.OFFLINE],
  inactive: [NodeState.REGISTERED, NodeState.DISABLED],
};

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/nodes/Index');

const nodeAdminService = useNodeAdminService();
const telemetryAdminService = useTelemetryAdminService();
const instanceAdminService = useInstanceAdminService();

const search = ref('');
const stateFilter = ref<StateFilter>('all');

const fleetNodes = shallowRef(new Map<number, FleetNodeTelemetryDto>());
const fleetLoaded = ref(false);
const instances = shallowRef<ListInstanceDto[]>([]);

const telemetrySubscription = shallowRef<ISseSubscription | null>(null);
const instanceSubscription = shallowRef<ISseSubscription | null>(null);

const listRequest = computed<NodeListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  state: FILTER_STATES[stateFilter.value],
}));

const unfiltered = computed(() => search.value.length === 0 && stateFilter.value === 'all');

const emptyDescription = computed(() => {
  if (search.value.length > 0) {
    return 'No nodes match your search.';
  }

  return unfiltered.value ? 'No nodes yet. Register a machine to start serving models.' : 'No nodes in this view.';
});

const onFleet = (fleet: FleetTelemetryResponseDto) => {
  fleetNodes.value = new Map(fleet.nodes.map(fleetNode => [fleetNode.nodeId, fleetNode]));
  fleetLoaded.value = true;
};

/** Registrations, renames and deletions reach no telemetry stream. */
const debouncedGetFleet = useDebounceFn(
  () => telemetryAdminService.getFleetTelemetry().then(onFleet),
  Config.LIST_DEBOUNCE_MS
);

const {
  list: nodeList,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    nodeAdminService
      .getNodeList(request, listPage)
      .then(response => ({ list: response.nodeList, pages: response.pages })),
  liveSubjects: [EventPartyType.NODE],
  onLive: () => {
    debouncedGetFleet().catch((error: unknown) => {
      logger.error({ error }, 'onLive(): Failed to refresh the fleet');
    });
  },
});

const countLabel = computed(() => {
  const shown = nodeList.value.length;

  return fleetLoaded.value ? `Showing ${shown} of ${fleetNodes.value.size} nodes` : `Showing ${shown} nodes`;
});

const devicesOf = (node: ListNodeDto): GpuTelemetryDto[] => fleetNodes.value.get(node.id)?.status.devices ?? [];

const gpuCount = (node: ListNodeDto): string => {
  const status = fleetNodes.value.get(node.id)?.status;

  return status === undefined || status.telemetryState === null ? '-' : `${status.devices.length}`;
};

const instanceCount = (node: ListNodeDto): string =>
  node.lastSeenDate === null ? '-' : `${instances.value.filter(instance => instance.nodeId === node.id).length}`;

const hasVram = (node: ListNodeDto): boolean =>
  node.state === NodeState.ONLINE && vramUsage(devicesOf(node)).totalBytes > 0;

onMounted(() => {
  telemetrySubscription.value = telemetryAdminService.streamFleetTelemetry(onFleet);

  instanceSubscription.value = instanceAdminService.streamInstances(response => {
    instances.value = response.instances;
  });
});

onBeforeUnmount(() => {
  telemetrySubscription.value?.close();
  instanceSubscription.value?.close();
});
</script>
