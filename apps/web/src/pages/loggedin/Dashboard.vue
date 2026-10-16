<template>
  <ui-page-container wide>
    <ui-page-heading title="Overview" :subtitle="subtitle" />

    <ui-notice v-if="!isAdmin" type="info">The fleet overview is available to system administrators.</ui-notice>

    <template v-else>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4">
        <mf-kpi-tile label="VRAM in use" :icon="IconMemory" v-bind="vramKpi" :stale="vramState === 'stale'" />

        <mf-kpi-tile label="Nodes" :icon="IconDns" v-bind="nodeKpi" :stale="telemetryState === 'stale'" />

        <mf-kpi-tile
          label="Deployments"
          :icon="IconRocketLaunch"
          v-bind="deploymentKpi"
          :stale="instanceState === 'stale'"
        />

        <mf-kpi-tile label="Instances" :icon="IconViewInAr" v-bind="instanceKpi" :stale="instanceState === 'stale'" />
      </div>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,26.25rem),1fr))] gap-4">
        <ui-card
          title="Nodes"
          subtitle="Measured VRAM on each node, Modelfleet's instances first."
          flush
          data-testid="nodes-card"
        >
          <ui-table :columns="NODE_COLUMNS" :min-width="0">
            <ui-table-head>
              <span>Node</span>
              <span>VRAM</span>
              <span></span>
            </ui-table-head>

            <ui-table-row
              v-for="node of fleetNodes ?? []"
              :key="node.nodeId"
              :to="`/nodes/${node.nodeId}`"
              data-testid="fleet-node-row"
            >
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-mono font-medium text-header">{{ node.nodeName }}</span>

                  <ui-tag :type="nodeStateTone(node.nodeState)">{{ formatNodeState(node.nodeState) }}</ui-tag>

                  <ui-tag v-if="isReadingStale(node.status, serverNowMs)" type="warning">Stale</ui-tag>
                </div>

                <div class="mt-0.5 truncate text-xs text-muted">
                  {{ describeFleetNode(node, instances, serverNowMs) ?? '-' }}
                </div>
              </div>

              <mf-gpu-vram-bar v-if="hasVram(node)" :devices="node.status.devices" processes />

              <span v-else class="text-right text-xs text-muted">No data</span>

              <icon-chevron-right class="size-4 text-muted" />
            </ui-table-row>

            <template v-if="fleetNodes?.length === 0" #empty>
              No nodes yet. Register a machine to start serving models.

              <div class="mt-3">
                <ui-button type="primary" to="/nodes/register">
                  <template #icon>
                    <icon-add class="size-4" />
                  </template>
                  Register Node
                </ui-button>
              </div>
            </template>
          </ui-table>

          <template #footer>
            <ui-button type="text" to="/nodes" class="-mr-4.5">
              <template #icon>
                <icon-arrow-forward class="size-4" />
              </template>
              View all nodes
            </ui-button>
          </template>
        </ui-card>

        <ui-card title="Deployments" :subtitle="deploymentsSubtitle" flush data-testid="deployments-card">
          <ui-table :columns="DEPLOYMENT_COLUMNS" :min-width="0">
            <ui-table-head>
              <span>Deployment</span>
              <span>State</span>
              <span></span>
            </ui-table-head>

            <ui-table-row
              v-for="{ deployment, runState } of deploymentRows"
              :key="deployment.id"
              :to="`/deployments/${deployment.id}`"
              data-testid="fleet-deployment-row"
            >
              <div class="min-w-0">
                <div class="truncate font-mono font-medium text-header">{{ deployment.name }}</div>

                <div class="mt-0.5 truncate text-xs text-muted">
                  {{ describeDeploymentPlacement(deployment, instances) }}
                </div>
              </div>

              <div>
                <ui-tag :type="deploymentRunTone(runState)">{{ formatDeploymentRunState(runState) }}</ui-tag>
              </div>

              <icon-chevron-right class="size-4 text-muted" />
            </ui-table-row>

            <template v-if="deploymentPage?.deploymentList.length === 0" #empty>
              <template v-if="hasModels">
                No deployments yet. Deploy a model to start serving it.

                <div class="mt-3">
                  <ui-button type="primary" to="/deployments/create">
                    <template #icon>
                      <icon-add class="size-4" />
                    </template>
                    Create Deployment
                  </ui-button>
                </div>
              </template>

              <template v-else>
                No models yet. Scan a node for model weights, then deploy one.

                <div class="mt-3">
                  <ui-button type="primary" to="/models">
                    <template #icon>
                      <icon-arrow-forward class="size-4" />
                    </template>
                    View Models
                  </ui-button>
                </div>
              </template>
            </template>
          </ui-table>

          <template #footer>
            <ui-button type="text" to="/deployments" class="-mr-4.5">
              <template #icon>
                <icon-arrow-forward class="size-4" />
              </template>
              View all deployments
            </ui-button>
          </template>
        </ui-card>
      </div>

      <ui-card
        title="Recent activity"
        subtitle="The latest events across the fleet, newest first."
        flush
        data-testid="activity-card"
      >
        <mf-event-table
          :events="recentEvents ?? []"
          :columns="EVENT_COLUMNS"
          :loading="loadingEvents"
          empty-description="Nothing has happened yet. Events appear here as the fleet changes."
        />

        <template #footer>
          <ui-button type="text" to="/events" class="-mr-4.5">
            <template #icon>
              <icon-arrow-forward class="size-4" />
            </template>
            View all events
          </ui-button>
        </template>
      </ui-card>
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconArrowForward from '~icons/material-symbols/arrow-forward-outline-rounded';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';
import IconDns from '~icons/material-symbols/dns-outline-rounded';
import IconMemory from '~icons/material-symbols/memory-outline-rounded';
import IconRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';
import IconViewInAr from '~icons/material-symbols/view-in-ar-outline-rounded';

import type { EventDto, FleetNodeTelemetryDto, FleetTelemetryResponseDto, ListInstanceDto } from '@libs/dto';
import { EventPartyType, NodeState, UserRoleId } from '@libs/dto';

import { Config } from '@/Config';

import {
  DeploymentRunState,
  countDeploymentRunStates,
  deploymentRunState,
  deploymentRunTone,
  describeDeploymentPlacement,
  formatDeploymentRunState,
} from '@/utils/deployment';
import { ICount, formatBytes, formatCount } from '@/utils/format/number';
import { isReadingStale, vramUsage } from '@/utils/gpu';
import { countInstanceStates, formatInstanceState, instanceStateTone } from '@/utils/instance';
import { countNodeStates, describeFleetNode, formatNodeState, nodeStateTone } from '@/utils/node';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useModelAdminService } from '@/services/api/admin/ModelAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';
import { TelemetryState, useTelemetryStore } from '@/stores/telemetry';
import { useUserStore } from '@/stores/user';

import {
  EventTableColumn,
  IKpiBand,
  IKpiLegendItem,
  MfEventTable,
  MfGpuVramBar,
  MfKpiTile,
  STATUS_METER_TONES,
} from '@/components/mf';
import {
  UiButton,
  UiCard,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

import { useResource } from '@/composables/useResource';

interface IKpiFigures {
  value: string | number;
  unit?: string;
  bands: IKpiBand[];
  legend: IKpiLegendItem[];
}

type StatusTone = keyof typeof STATUS_METER_TONES;

const NODE_COLUMNS = 'minmax(0, 1fr) 11rem 1rem';

const DEPLOYMENT_COLUMNS = 'minmax(0, 1fr) 6.5rem 1rem';

const DEPLOYMENT_ROW_COUNT = 5;

const RECENT_EVENT_COUNT = 8;

const EVENT_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary'];

const RUN_STATE_RANKS: Record<DeploymentRunState, number> = {
  failed: 0,
  starting: 1,
  ready: 2,
  idle: 3,
};

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/Dashboard');

const deploymentAdminService = useDeploymentAdminService();
const eventAdminService = useEventAdminService();
const instanceAdminService = useInstanceAdminService();
const modelAdminService = useModelAdminService();
const telemetryAdminService = useTelemetryAdminService();

const telemetryStore = useTelemetryStore();
const userStore = useUserStore();

const isAdmin = computed(() => userStore.hasRole(UserRoleId.SYSTEM_ADMIN));

const adminRequest = () => (isAdmin.value ? {} : null);

const fleetNodes = ref<FleetNodeTelemetryDto[] | null>(null);
const instances = ref<ListInstanceDto[]>([]);

/** How far this browser's clock runs ahead of the server's, measured off each fleet read. */
const clockOffsetMs = ref(0);

const telemetrySubscription = shallowRef<ISseSubscription | null>(null);
const instanceSubscription = shallowRef<ISseSubscription | null>(null);
const eventSubscription = shallowRef<ISseSubscription | null>(null);

const { data: deploymentPage, reload: reloadDeployments } = useResource({
  request: adminRequest,
  fetch: () => deploymentAdminService.getDeploymentList({}, 1),
});

const { data: modelPage, reload: reloadModels } = useResource({
  request: adminRequest,
  fetch: () => modelAdminService.getModelList({}, 1),
});

const {
  data: recentEvents,
  loading: loadingEvents,
  reload: reloadEvents,
} = useResource({
  request: adminRequest,
  fetch: () => eventAdminService.getEventList({}, 1).then(response => response.eventList.slice(0, RECENT_EVENT_COUNT)),
});

const telemetryState = computed(() => telemetryStore.stateOf(telemetrySubscription.value));
const instanceState = computed(() => telemetryStore.stateOf(instanceSubscription.value));

/** A node that stops reporting keeps its last reading, so the fleet figure goes stale with it. */
const serverNowMs = computed(() => telemetryStore.now - clockOffsetMs.value);

const vramState = computed<TelemetryState>(() => {
  const readingStale = (fleetNodes.value ?? []).some(
    node => node.nodeState === NodeState.ONLINE && isReadingStale(node.status, serverNowMs.value)
  );

  return readingStale ? 'stale' : telemetryState.value;
});

const fleetDevices = computed(() => (fleetNodes.value ?? []).flatMap(node => node.status.devices));

const deploymentTotal = computed(() => deploymentPage.value?.total ?? 0);

const hasModels = computed(() => (modelPage.value?.modelList.length ?? 0) > 0);

const deploymentCounts = computed(() => countDeploymentRunStates(deploymentTotal.value, instances.value));

const subtitle = computed(() => {
  if (!isAdmin.value) {
    return 'View the current state of your fleet.';
  }

  return `${formatCount(fleetNodes.value?.length ?? 0, 'node')} and ${formatCount(fleetDevices.value.length, 'GPU')}.`;
});

const deploymentsSubtitle = computed(() => {
  if (deploymentTotal.value === 0) {
    return undefined;
  }

  const ready = deploymentCounts.value.find(entry => entry.key === 'ready')?.count ?? 0;

  return `${ready} of ${deploymentTotal.value} ready. Problems are listed first.`;
});

const deploymentRows = computed(() =>
  (deploymentPage.value?.deploymentList ?? [])
    .map(deployment => ({ deployment, runState: deploymentRunState(deployment.id, instances.value) }))
    .sort((first, second) => RUN_STATE_RANKS[first.runState] - RUN_STATE_RANKS[second.runState])
    .slice(0, DEPLOYMENT_ROW_COUNT)
);

const stateBreakdown = <State,>(
  counts: ICount<State>[],
  label: (state: State) => string,
  tone: (state: State) => StatusTone
): Pick<IKpiFigures, 'bands' | 'legend'> => ({
  bands: counts.map(({ key, count }) => ({ tone: STATUS_METER_TONES[tone(key)], percent: count })),
  legend: counts.map(({ key, count }) => ({
    label: `${count} ${label(key).toLowerCase()}`,
    tone: STATUS_METER_TONES[tone(key)],
  })),
});

const vramKpi = computed<IKpiFigures>(() => {
  const { usedBytes, totalBytes, freeBytes } = vramUsage(fleetDevices.value);

  if (totalBytes === 0) {
    return { value: '-', bands: [], legend: [{ label: 'No readings yet' }] };
  }

  const percent = Math.round((usedBytes / totalBytes) * 100);

  return {
    value: formatBytes(usedBytes),
    unit: `of ${formatBytes(totalBytes)}`,
    bands: [{ tone: 'primary', percent }, { percent: 100 - percent }],
    legend: [{ label: `${percent}% in use`, tone: 'primary' }, { label: `${formatBytes(freeBytes)} free` }],
  };
});

const nodeKpi = computed<IKpiFigures>(() => ({
  value: fleetNodes.value?.length ?? 0,
  unit: formatCount(fleetDevices.value.length, 'GPU'),
  ...stateBreakdown(
    countNodeStates((fleetNodes.value ?? []).map(node => node.nodeState)),
    formatNodeState,
    nodeStateTone
  ),
}));

const deploymentKpi = computed<IKpiFigures>(() => ({
  value: deploymentTotal.value,
  ...stateBreakdown(deploymentCounts.value, formatDeploymentRunState, deploymentRunTone),
}));

const instanceKpi = computed<IKpiFigures>(() => ({
  value: instances.value.length,
  ...stateBreakdown(countInstanceStates(instances.value), formatInstanceState, instanceStateTone),
}));

const hasVram = (node: FleetNodeTelemetryDto): boolean =>
  node.nodeState === NodeState.ONLINE && vramUsage(node.status.devices).totalBytes > 0;

const onFleet = (fleet: FleetTelemetryResponseDto) => {
  fleetNodes.value = fleet.nodes;
  clockOffsetMs.value = Date.now() - fleet.readAt.getTime();
};

const doGetTelemetry = () => {
  telemetryAdminService
    .getFleetTelemetry()
    .then(onFleet)
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetTelemetry(): Failed to get fleet telemetry');
    });
};

const debouncedGetTelemetry = useDebounceFn(doGetTelemetry, Config.LIST_DEBOUNCE_MS);
const debouncedReloadDeployments = useDebounceFn(reloadDeployments, Config.LIST_DEBOUNCE_MS);
const debouncedReloadModels = useDebounceFn(reloadModels, Config.LIST_DEBOUNCE_MS);

/** Node registrations and renames reach no telemetry stream, and the lists behind the other panels have none. */
const onLiveEvent = (event: EventDto) => {
  const earlier = (recentEvents.value ?? []).filter(recent => recent.id !== event.id);

  recentEvents.value = [event, ...earlier].slice(0, RECENT_EVENT_COUNT);

  const refresh = (debounced: () => Promise<void>, name: string) => {
    debounced().catch((error: unknown) => {
      logger.error({ error }, `onLiveEvent(): Failed to refresh ${name}`);
    });
  };

  if (event.subjectType === EventPartyType.NODE) {
    refresh(debouncedGetTelemetry, 'nodes');
  }

  if (event.subjectType === EventPartyType.DEPLOYMENT) {
    refresh(debouncedReloadDeployments, 'deployments');
  }

  if (event.subjectType === EventPartyType.MODEL) {
    refresh(debouncedReloadModels, 'models');
  }
};

const onReconnectEvents = () => {
  void reloadEvents();
  void reloadDeployments();
  void reloadModels();
};

onMounted(() => {
  if (!isAdmin.value) {
    return;
  }

  telemetrySubscription.value = telemetryAdminService.streamFleetTelemetry(onFleet);

  instanceSubscription.value = instanceAdminService.streamInstances(response => {
    instances.value = response.instances;
  });

  eventSubscription.value = eventAdminService.streamEvents(onLiveEvent, onReconnectEvents);
});

onBeforeUnmount(() => {
  telemetrySubscription.value?.close();
  instanceSubscription.value?.close();
  eventSubscription.value?.close();
});
</script>
