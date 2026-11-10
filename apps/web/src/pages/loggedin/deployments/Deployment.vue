<template>
  <ui-page-container wide>
    <ui-page-heading v-if="deployment">
      <template #title>
        <span class="break-all font-mono">{{ deployment.name }}</span>
      </template>

      <template #subtitle>
        <ui-link :to="`/models/${deployment.modelId}`" muted data-testid="deployment-model-link">
          {{ deployment.modelName }}
        </ui-link>
        on {{ deployment.backend }}
      </template>

      <div class="flex flex-wrap items-center gap-2">
        <mf-licence-tag :licence="deployment.modelLicence" />

        <ui-button :to="`/deployments/${deployment.id}/configuration`">
          <template #icon>
            <icon-edit class="size-4" />
          </template>
          Edit Settings
        </ui-button>
      </div>
    </ui-page-heading>

    <ui-back-link v-else />

    <div v-if="loadingDeployment && !deployment" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!deployment">
      <ui-empty>Could not load this deployment.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="!deployment.enabled" type="warning" title="Disabled">
        Enable this deployment to start instances and accept requests.

        <template #action>
          <ui-button type="primary" :loading="updatingState" @click="changeState">Enable Deployment</ui-button>
        </template>
      </ui-notice>

      <ui-notice
        v-if="instancesNeedingRestart.length > 0"
        type="warning"
        title="The configuration has changed"
        data-testid="older-settings"
      >
        {{ formatCount(instancesNeedingRestart.length, 'instance') }} on older settings. Restart to use the latest
        settings.

        <template #action>
          <ui-button type="primary" :loading="restarting" @click="confirmRestart">
            <template #icon>
              <icon-restart-alt class="size-4" />
            </template>
            Restart
          </ui-button>
        </template>
      </ui-notice>

      <ui-notice v-if="restartInProgress" type="info" title="Restart in progress" data-testid="restart-progress">
        Instances are restarting with the latest settings.
      </ui-notice>

      <ui-notice v-if="makingRoom" type="info" title="Making room for this deployment" data-testid="making-room">
        Idle instances are stopping. This deployment will start when memory is available.
      </ui-notice>

      <ui-notice v-else-if="placement?.problem" type="warning" title="Unable to start">
        {{ placement.problem }}.
      </ui-notice>

      <ui-notice v-if="givenUp" type="error" title="Automatic retries paused" data-testid="launch-given-up">
        Repeated start attempts have failed. Select Start Now to retry, or change the settings.

        <ui-code v-if="residency?.lastLaunchFailure" block tone="error" class="mt-2">
          {{ residency.lastLaunchFailure }}
        </ui-code>

        <template #action>
          <ui-button type="primary" :loading="starting" @click="requestStart">
            <template #icon>
              <icon-play-arrow class="size-4" />
            </template>
            Start Now
          </ui-button>
        </template>
      </ui-notice>

      <ui-notice v-else-if="launchRetry" type="warning" title="Waiting to retry" data-testid="launch-retry">
        {{ launchRetry }}
      </ui-notice>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4" data-testid="deployment-kpis">
        <mf-kpi-tile label="Instances" :icon="IconViewInAr" v-bind="instanceKpi" />

        <mf-kpi-tile label="Activation" :icon="IconPowerSettingsNew" v-bind="activationKpi" />

        <mf-kpi-tile label="In flight" :icon="IconHourglassTop" v-bind="inFlightKpi" />
      </div>

      <ui-card
        title="Instances"
        subtitle="Instances of this deployment and their current status."
        flush
        data-testid="instances-card"
      >
        <template #header-extra>
          <div class="flex shrink-0 gap-2">
            <ui-button v-if="running" type="danger-outline" :loading="stopping" @click="confirmStop">
              <template #icon>
                <icon-stop class="size-4" />
              </template>
              Stop
            </ui-button>

            <ui-button
              v-if="!givenUp && (startable || !running)"
              type="primary"
              :loading="starting"
              :disabled="!startable"
              @click="requestStart"
            >
              <template #icon>
                <icon-play-arrow class="size-4" />
              </template>
              Start Now
            </ui-button>
          </div>
        </template>

        <mf-instance-table
          :instances="instances"
          party="node"
          :loading="loadingInstances"
          empty-description="No instances are running."
        />
      </ui-card>

      <ui-card
        v-if="placementTable.length > 0"
        title="Placement"
        subtitle="What each node holds or is expected to take, and whether it fits."
        flush
        data-testid="placement-card"
      >
        <ui-table :columns="PLACEMENT_COLUMNS" :min-width="680">
          <ui-table-head>
            <span>Node</span>
            <span>VRAM</span>
            <span>RAM</span>
            <span>Status</span>
            <span></span>
          </ui-table-head>

          <ui-table-row v-for="row of placementTable" :key="row.nodeId" data-testid="placement-row">
            <div class="min-w-0 truncate">
              <ui-link
                :to="`/nodes/${row.nodeId}`"
                class="max-w-full font-mono font-medium"
                data-testid="placement-node-link"
                @click.stop
              >
                <span class="truncate">{{ row.nodeName }}</span>
              </ui-link>
            </div>

            <span
              class="font-mono text-xs"
              :class="row.vram.short ? 'text-error' : 'text-highlight'"
              data-testid="placement-vram"
            >
              <ui-hint :text="row.vram.title ?? undefined">{{ row.vram.text }}</ui-hint>
            </span>

            <span class="font-mono text-xs" :class="{ 'text-error': row.ram.short }" data-testid="placement-ram">
              <ui-hint :text="row.ram.title ?? undefined">{{ row.ram.text }}</ui-hint>
            </span>

            <div>
              <ui-tag :type="placementFitTone(row.fit)" :hint="row.reason ?? undefined" data-testid="placement-status">
                {{ formatPlacementFit(row.fit) }}
              </ui-tag>
            </div>

            <span v-if="!row.expandable"></span>

            <template v-if="row.expandable" #expand>
              <div class="bg-inset" data-testid="placement-refusal">
                <ui-table :columns="PLACEMENT_CARD_COLUMNS" :min-width="640">
                  <ui-table-head>
                    <span>Card</span>
                    <span>Total</span>
                    <span>Used</span>
                    <span>Starting</span>
                    <span>Headroom</span>
                    <span>Free</span>
                  </ui-table-head>

                  <ui-table-row
                    v-for="card of row.cards"
                    :key="card.deviceKey"
                    :class="{ 'text-error': card.short }"
                    data-testid="placement-card-row"
                  >
                    <div class="min-w-0">
                      <div class="truncate font-mono text-xs" :class="card.short ? 'text-error' : 'text-header'">
                        {{ card.deviceKey }}
                      </div>
                      <div
                        v-if="card.name"
                        class="mt-0.5 truncate text-xs"
                        :class="card.short ? 'text-error' : 'text-muted'"
                      >
                        {{ card.name }}
                      </div>
                    </div>

                    <span class="font-mono text-xs">{{ card.total }}</span>

                    <span class="font-mono text-xs">{{ card.used }}</span>

                    <span class="font-mono text-xs">{{ card.starting }}</span>

                    <span class="font-mono text-xs">{{ card.headroom }}</span>

                    <span class="font-mono text-xs">{{ card.free }}</span>
                  </ui-table-row>

                  <ui-table-row v-if="row.poolRam !== null" data-testid="placement-card-row">
                    <span class="truncate text-xs text-header">RAM</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">{{ row.poolRam }}</span>
                  </ui-table-row>
                </ui-table>
              </div>
            </template>
          </ui-table-row>
        </ui-table>
      </ui-card>

      <ui-card v-if="configuration" title="Settings in use" subtitle="The values this deployment runs with." flush>
        <template v-if="deployment.presetId !== null" #header-extra>
          <div class="shrink-0 text-sm text-muted">
            Preset:
            <ui-link :to="`/presets/${deployment.presetId}`" muted data-testid="deployment-preset-link">
              {{ deployment.presetName }}
            </ui-link>
          </div>
        </template>

        <mf-effective-configuration :configuration="configuration" :placement-nodes="placement?.nodes ?? []" />
      </ui-card>

      <ui-card title="Event log" subtitle="Events for this deployment." flush data-testid="event-log-card">
        <!-- Keyed by page so changing page returns the rows to the top rather than keeping the last page's offset. -->
        <mf-event-table
          :key="historyPage"
          :events="history"
          :columns="HISTORY_COLUMNS"
          :loading="loadingHistory"
          scroll-label="Event log"
          empty-description="No events have been recorded for this deployment yet."
        />

        <template v-if="historyPages > 1" #footer>
          <ui-pagination v-model:page="historyPage" :page-count="historyPages" />
        </template>
      </ui-card>

      <mf-danger-card
        v-if="deployment.enabled"
        label="Disable deployment"
        help="The scheduler stops each instance after its current requests finish, and starts nothing until you enable it."
        action-label="Disable Deployment"
        :loading="updatingState"
        :disabled="deleting"
        @action="changeState"
      >
        <ui-form-field layout="row" align="end" label="Delete deployment" :help="DELETE_HELP">
          <ui-button type="danger-outline" :loading="deleting" :disabled="updatingState" @click="confirmDelete">
            Delete Deployment
          </ui-button>
        </ui-form-field>
      </mf-danger-card>

      <mf-danger-card
        v-else
        label="Delete deployment"
        :help="DELETE_HELP"
        action-label="Delete Deployment"
        :loading="deleting"
        :disabled="updatingState"
        @action="confirmDelete"
      />
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { useNow } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import IconEdit from '~icons/material-symbols/edit-outline-rounded';
import IconHourglassTop from '~icons/material-symbols/hourglass-top-outline-rounded';
import IconPlayArrow from '~icons/material-symbols/play-arrow-outline-rounded';
import IconPowerSettingsNew from '~icons/material-symbols/power-settings-new-outline-rounded';
import IconRestartAlt from '~icons/material-symbols/restart-alt-rounded';
import IconStop from '~icons/material-symbols/stop-outline-rounded';
import IconViewInAr from '~icons/material-symbols/view-in-ar-outline-rounded';

import type {
  DeploymentDto,
  DeploymentConfigurationDto,
  DeploymentInstancesResponseDto,
  DeploymentResidencyDto,
  EventDto,
  EventFilterRequestDto,
  InstancePlacementDto,
  ListInstanceDto,
  StartInstanceResponseDto,
} from '@libs/dto';
import { EventPartyType, EventType, ResidencyRule } from '@libs/dto';

import { DialogType } from '@/types/dialog';
import { Notification, NotificationType } from '@/types/notification';

import {
  describeLaunchFailures,
  formatActivationPolicy,
  formatPlacementFit,
  placementFitTone,
  placementRows,
} from '@/utils/deployment';
import { formatDuration, formatRelativeDate } from '@/utils/format/date';
import { formatCount } from '@/utils/format/number';
import { capacityFigures, describeMemory } from '@/utils/gpu';
import { countInstanceStates, formatInstanceState, instanceStateTone } from '@/utils/instance';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useToastStore } from '@/stores/toast';

import {
  EventTableColumn,
  IKpiBand,
  IKpiLegendItem,
  MfDangerCard,
  MfEffectiveConfiguration,
  MfEventTable,
  MfInstanceTable,
  MfKpiTile,
  MfLicenceTag,
  STATUS_METER_TONES,
} from '@/components/mf';
import {
  UiBackLink,
  UiButton,
  UiCard,
  UiCode,
  UiEmpty,
  UiFormField,
  UiLink,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiSpinner,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiHint,
  UiTag,
} from '@/components/ui';

import { useGoBack } from '@/composables/useGoBack';
import { usePage } from '@/composables/usePage';
import { usePagedList } from '@/composables/usePagedList';

interface IKpiFigures {
  value: string | number;
  unit?: string;
  bands: IKpiBand[];
  legend: IKpiLegendItem[];
}

const HISTORY_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary', 'actor'];

const PLACEMENT_COLUMNS = 'minmax(0, 1fr) 11rem 11rem 9.5rem 1rem';

const PLACEMENT_CARD_COLUMNS = 'minmax(0, 1fr) repeat(5, 6rem)';

const DELETE_HELP = 'Its instances stop and requests to it fail. You can reuse the name.';

/** The instance stream carries these already, so refetching the deployment for one would only repeat it. */
const INSTANCE_EVENTS: EventType[] = [
  EventType.INSTANCE_STARTED,
  EventType.INSTANCE_STOPPED,
  EventType.INSTANCE_START_REFUSED,
];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/deployments/Deployment');

const route = useRoute();
const { goBack } = useGoBack();
const dialogStore = useDialogStore();

const notificationStore = useNotificationStore();
const toastStore = useToastStore();
const deploymentAdminService = useDeploymentAdminService();
const eventAdminService = useEventAdminService();
const instanceAdminService = useInstanceAdminService();

const deploymentId = computed(() =>
  typeof route.params.deploymentId === 'string' ? parseInt(route.params.deploymentId, 10) : null
);

const deployment = ref<DeploymentDto | null>(null);

usePage({ title: () => deployment.value?.name ?? '', back: '/deployments' });

const configuration = ref<DeploymentConfigurationDto | null>(null);
const instances = ref<ListInstanceDto[]>([]);
const placement = ref<InstancePlacementDto | null>(null);
const residency = ref<DeploymentResidencyDto | null>(null);

const loadingDeployment = ref(false);
const loadingInstances = ref(false);
const restarting = ref(false);
const deleting = ref(false);
const updatingState = ref(false);
const starting = ref(false);
const stopping = ref(false);

const subscription = shallowRef<ISseSubscription | null>(null);
const eventSubscription = shallowRef<ISseSubscription | null>(null);

const running = computed(() => instances.value.length > 0);

const olderInstances = computed(() => instances.value.filter(instance => instance.onOlderSettings));

const instancesNeedingRestart = computed(() => olderInstances.value.filter(instance => !instance.restartRequested));

const restartInProgress = computed(
  () => residency.value?.restarting === true || olderInstances.value.some(instance => instance.restartRequested)
);

const makingRoomNodeIds = computed(() => residency.value?.makingRoomNodeIds ?? []);

const makingRoom = computed(() => makingRoomNodeIds.value.length > 0);

const placementTable = computed(() => placementRows(placement.value?.nodes ?? [], makingRoomNodeIds.value));

const enabled = computed(() => deployment.value?.enabled === true);

/*
 * Reads the page's own enabled flag too, since the residency can arrive after the toggle's refetch. The notice
 * carries the page's one start, since `startable` counts a failed instance as its node's share.
 */
const givenUp = computed(() => enabled.value && residency.value?.givenUp === true);

/** A node short of its replicas is one a start would act on, so a fully placed deployment offers nothing to do. */
const startable = computed(
  () =>
    enabled.value && (placement.value?.nodes ?? []).some(node => node.problem === null && node.running < node.replicas)
);

const now = useNow({ interval: 1000 });

const launchRetry = computed(() =>
  residency.value === null || !enabled.value ? null : describeLaunchFailures(residency.value, now.value)
);

const expectedInstances = computed(() =>
  (placement.value?.nodes ?? []).reduce((total, node) => total + node.replicas, 0)
);

const instanceKpi = computed<IKpiFigures>(() => {
  const counts = countInstanceStates(instances.value);
  const missing = Math.max(0, expectedInstances.value - instances.value.length);

  const bands: IKpiBand[] = counts.map(({ key, count }) => ({
    tone: STATUS_METER_TONES[instanceStateTone(key)],
    percent: count,
  }));
  const legend: IKpiLegendItem[] = counts.map(({ key, count }) => ({
    label: `${count} ${formatInstanceState(key).toLowerCase()}`,
    tone: STATUS_METER_TONES[instanceStateTone(key)],
  }));

  if (missing > 0) {
    bands.push({ percent: missing });
    legend.push({ label: `${missing} not running` });
  }

  return {
    value: instances.value.length,
    unit: expectedInstances.value > 0 ? `of ${expectedInstances.value} expected` : undefined,
    bands,
    legend: legend.length > 0 ? legend : [{ label: 'None running' }],
  };
});

const activationKpi = computed<IKpiFigures>(() => {
  const value = deployment.value === null ? '-' : formatActivationPolicy(deployment.value.activationPolicy);
  const rule = residency.value?.rule;

  if (rule === ResidencyRule.DISABLED) {
    return { value, bands: [], legend: [{ label: 'Held down while disabled', tone: 'error' }] };
  }

  if (rule === ResidencyRule.IDLE_TIMEOUT) {
    const timeout = formatDuration((residency.value?.idleTimeoutMs ?? 0) / 1000);

    return { value, bands: [], legend: [{ label: `Starts on a request, stops after ${timeout} idle` }] };
  }

  return { value, bands: [], legend: [{ label: 'Kept running by the scheduler' }] };
});

const inFlightKpi = computed<IKpiFigures>(() => {
  const lastUsed = residency.value?.lastUsedDate ?? null;

  return {
    value: residency.value?.inFlight ?? 0,
    unit: 'requests',
    bands: [],
    legend: [{ label: lastUsed === null ? 'Not called yet' : `Last called ${formatRelativeDate(lastUsed)}` }],
  };
});

const doGetInstances = () => {
  if (deploymentId.value === null) {
    return;
  }

  loadingInstances.value = true;
  instanceAdminService
    .getDeploymentInstances(deploymentId.value)
    .then(response => {
      onInstances(response);
    })
    .finally(() => {
      loadingInstances.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetInstances(): Failed to get the instances of this deployment');
    });
};

const onInstances = (response: DeploymentInstancesResponseDto) => {
  instances.value = response.instances;
  placement.value = response.placement;
  residency.value = response.residency;
};

const evictions = computed(() =>
  makingRoom.value ? [] : (placement.value?.nodes.flatMap(node => node.evictions) ?? [])
);

const evictedDeploymentNames = computed(() =>
  [...new Set(evictions.value.map(eviction => eviction.deploymentName))].join(', ')
);

const requestStart = () => {
  if (evictions.value.length === 0) {
    void doStart(false);

    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: 'Stop instances to free memory?',
    message:
      'This deployment needs more memory to start. ' +
      `Instances of these deployments will stop to free memory: ${evictedDeploymentNames.value}`,
    confirmLabel: 'Stop Instances and Start',
    action: () => doStart(true),
  });
};

const doStart = (confirmEviction: boolean): Promise<void> => {
  if (deploymentId.value === null) {
    return Promise.resolve();
  }

  starting.value = true;

  return (
    confirmEviction
      ? instanceAdminService.startDeployment(deploymentId.value, null, true)
      : instanceAdminService.startDeployment(deploymentId.value)
  )
    .then(started => {
      announceStart(started);

      doGetInstances();
    })
    .finally(() => {
      starting.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doStart(): Failed to start this deployment');
    });
};

const announceStart = (started: StartInstanceResponseDto) => {
  if (started.evicting.length > 0) {
    toastStore.addToast(
      'Making room',
      `Stopping ${formatCount(started.evicting.length, 'instance')} to free memory for this deployment.`
    );
  }

  if (started.refused.length > 0) {
    const tone = started.started > 0 ? NotificationType.SUCCESS : NotificationType.WARNING;

    notificationStore.addNotification(new Notification(startedMessage(started), tone));
  } else if (started.started > 0) {
    toastStore.addToast('Deployment started', `Started ${formatCount(started.started, 'instance')}.`);
  } else if (started.evicting.length === 0) {
    toastStore.addToast('Nothing to start', 'Instances are already running or waiting for available memory.');
  }
};

const startedMessage = (started: StartInstanceResponseDto): string => {
  const refusedNodes = started.refused
    .map(node =>
      node.capacity === null
        ? node.nodeName
        : `${node.nodeName} (${describeMemory(capacityFigures(node.capacity)).join(', ')})`
    )
    .join(', ');

  if (started.started === 0) {
    return `No instances started. Could not start on: ${refusedNodes}`;
  }

  return `Started ${formatCount(started.started, 'instance')}. Could not start on: ${refusedNodes}`;
};

const confirmStop = () => {
  const id = deploymentId.value;

  if (id === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Stop ${deployment.value?.name ?? 'this deployment'}?`,
    message: 'All instances will stop and release their memory. Requests to this deployment will fail.',
    confirmLabel: 'Stop Deployment',
    action: () => doStop(id),
  });
};

const doStop = (id: number): Promise<void> => {
  stopping.value = true;

  return instanceAdminService
    .stopDeployment(id)
    .then(() => {
      toastStore.addToast('Stop requested');

      doGetInstances();
    })
    .finally(() => {
      stopping.value = false;
    });
};

const historyRequest = computed<EventFilterRequestDto | null>(() =>
  deploymentId.value === null ? null : { subjectType: EventPartyType.DEPLOYMENT, subjectId: `${deploymentId.value}` }
);

const {
  list: history,
  page: historyPage,
  pages: historyPages,
  loading: loadingHistory,
  load: loadHistory,
} = usePagedList({
  request: historyRequest,
  debounceRequest: false,
  fetch: (request, page) =>
    eventAdminService
      .getEventList(request, page)
      .then(response => ({ list: response.eventList, pages: response.pages })),
});

// The log grows at the head, so only the first page can take an arriving event without shifting.
const refreshHistory = () => {
  if (historyPage.value !== 1) {
    return;
  }

  void loadHistory();
};

const onLiveEvent = (event: EventDto) => {
  // The deleted event arrives after the row is gone, so a reread would answer not found.
  if (
    event.subjectType !== EventPartyType.DEPLOYMENT ||
    event.subjectId !== `${deploymentId.value ?? ''}` ||
    event.type === EventType.DEPLOYMENT_DELETED
  ) {
    return;
  }

  refreshHistory();

  if (!INSTANCE_EVENTS.includes(event.type)) {
    doGetDeployment();
  }
};

const onReconnect = () => {
  doGetDeployment();
  refreshHistory();
};

const doGetDeployment = () => {
  if (deploymentId.value === null) {
    return;
  }

  const requested = deploymentId.value;

  loadingDeployment.value = true;
  deploymentAdminService
    .getDeployment(requested)
    .then(deploymentResponse => {
      deployment.value = deploymentResponse;

      return deploymentAdminService.getDeploymentConfiguration(requested);
    })
    .then(configurationResponse => {
      configuration.value = configurationResponse;
    })
    .finally(() => {
      loadingDeployment.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetDeployment(): Failed to get deployment');
    });
};

const confirmRestart = () => {
  const target = deployment.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Restart instances of ${target.name}?`,
    message:
      'Instances on older settings restart one at a time with the latest settings. Idle instances restart immediately; busy instances wait for active and queued requests to finish.',
    confirmLabel: 'Restart Instances',
    action: () => doRestart(target.id),
  });
};

const doRestart = (id: number): Promise<void> => {
  restarting.value = true;

  return deploymentAdminService
    .restartDeployment(id)
    .then(() => {
      toastStore.addToast('Restart requested', 'Instances restart after pending requests finish.');

      doGetInstances();
    })
    .finally(() => {
      restarting.value = false;
    });
};

const changeState = () => {
  const target = deployment.value;

  if (target === null) {
    return;
  }

  if (!target.enabled) {
    doSetEnabled(target.id, true).catch((error: unknown) => {
      logger.error({ error }, 'changeState(): Failed to enable this deployment');
    });

    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Disable ${target.name}?`,
    message:
      'The scheduler stops each instance after its current requests finish. Requests will fail until you enable the deployment.',
    confirmLabel: 'Disable Deployment',
    action: () => doSetEnabled(target.id, false),
  });
};

const doSetEnabled = (id: number, enabled: boolean): Promise<void> => {
  updatingState.value = true;

  return deploymentAdminService
    .updateDeploymentState(id, { enabled })
    .then(() => {
      toastStore.addToast(
        enabled ? 'Deployment enabled' : 'Deployment disabled',
        enabled
          ? 'It can now start and accept requests.'
          : 'Its instances will stop after their current requests finish.'
      );

      doGetDeployment();
      doGetInstances();
    })
    .finally(() => {
      updatingState.value = false;
    });
};

const confirmDelete = () => {
  const target = deployment.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Delete ${target.name}?`,
    message: DELETE_HELP,
    confirmLabel: 'Delete Deployment',
    action: () => doDeleteDeployment(target),
  });
};

const doDeleteDeployment = (target: DeploymentDto): Promise<void> => {
  deleting.value = true;

  return deploymentAdminService
    .deleteDeployment(target.id)
    .then(() => {
      toastStore.addToast('Deployment deleted');

      goBack({ replace: true });
    })
    .finally(() => {
      deleting.value = false;
    });
};

watchEffect(() => {
  doGetDeployment();
  doGetInstances();
});

watchEffect(onCleanup => {
  if (deploymentId.value === null) {
    return;
  }

  subscription.value = instanceAdminService.streamDeploymentInstances(deploymentId.value, onInstances);

  onCleanup(() => {
    subscription.value?.close();
    subscription.value = null;
  });
});

onMounted(() => {
  eventSubscription.value = eventAdminService.streamEvents(onLiveEvent, onReconnect);
});

onBeforeUnmount(() => {
  subscription.value?.close();
  eventSubscription.value?.close();
});
</script>
