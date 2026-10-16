<template>
  <ui-page-container wide>
    <ui-page-heading v-if="deployment" back-to="/deployments" back-label="Deployments">
      <template #title>
        <span class="break-all font-mono">{{ deployment.name }}</span>
      </template>

      <template #subtitle>
        <ui-link :to="`/models/${deployment.modelId}`" data-testid="deployment-model-link">
          {{ deployment.modelName }}
        </ui-link>
        on {{ deployment.backend }} ·
        <template v-if="deployment.presetId !== null">
          preset
          <ui-link :to="`/presets/${deployment.presetId}`" data-testid="deployment-preset-link">
            {{ deployment.presetName }}
          </ui-link>
        </template>
        <template v-else>its own settings</template>
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

    <ui-back-link v-else to="/deployments" label="Deployments" />

    <div v-if="loadingDeployment && !deployment" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!deployment">
      <ui-empty>Could not load this deployment.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="!deployment.enabled" type="warning" title="Disabled">
        The scheduler starts nothing for this deployment, and requests to it fail, until you enable it again.

        <template #action>
          <ui-button type="primary" :loading="updatingState" @click="changeState">Enable Deployment</ui-button>
        </template>
      </ui-notice>

      <ui-notice v-if="deployment.outOfDate" type="warning" title="Changes waiting to be applied">
        Settings other than <ui-code>replicas</ui-code>, <ui-code>idleTimeout</ui-code> and
        <ui-code>vramGib</ui-code> need a relaunch. Applying restarts the instances one at a time.

        <template #action>
          <ui-button type="primary" :loading="applying" @click="confirmApply">
            <template #icon>
              <icon-restart-alt class="size-4" />
            </template>
            Apply Changes
          </ui-button>
        </template>
      </ui-notice>

      <ui-notice v-if="placement?.problem" type="warning" title="This deployment cannot be started">
        {{ placement.problem }}.
      </ui-notice>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4" data-testid="deployment-kpis">
        <mf-kpi-tile label="Instances" :icon="IconViewInAr" v-bind="instanceKpi" />

        <mf-kpi-tile label="Activation" :icon="IconPowerSettingsNew" v-bind="activationKpi" />

        <mf-kpi-tile label="In flight" :icon="IconHourglassTop" v-bind="inFlightKpi" />
      </div>

      <ui-card title="Instances" flush data-testid="instances-card">
        <template #subtitle>
          <span data-testid="residency">{{ residencyLine }}</span>
        </template>

        <template #header-extra>
          <div class="flex shrink-0 gap-2">
            <ui-button v-if="running" type="danger-outline" :loading="stopping" @click="confirmStop">
              <template #icon>
                <icon-stop class="size-4" />
              </template>
              Stop
            </ui-button>

            <ui-button
              v-if="startable || !running"
              type="primary"
              :loading="starting"
              :disabled="!startable"
              @click="doStart"
            >
              <template #icon>
                <icon-play-arrow class="size-4" />
              </template>
              Start Now
            </ui-button>
          </div>
        </template>

        <div v-if="givenUp" class="border-b border-divider px-6 py-4">
          <ui-notice type="error" title="The scheduler has given up on this deployment">
            Its last {{ residency?.launchFailures }} starts failed in a row, so nothing starts it again until you start
            it or change its settings.

            <ui-code v-if="residency?.lastLaunchFailure" block tone="error" class="mt-2">
              {{ residency.lastLaunchFailure }}
            </ui-code>

            <template #action>
              <ui-button type="danger" :loading="starting" @click="doStart">Start Now</ui-button>
            </template>
          </ui-notice>
        </div>

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
        subtitle="What each node is expected to take, and whether it fits."
        flush
        data-testid="placement-card"
      >
        <ui-table :columns="PLACEMENT_COLUMNS" :min-width="860">
          <ui-table-head>
            <span>Node</span>
            <span>Expected</span>
            <span>Free</span>
            <span>Kept off the GPUs</span>
            <span>System memory</span>
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

            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-xs" :class="row.expectedShort ? 'text-error' : 'text-highlight'">
                {{ row.expected }}
              </span>

              <ui-tag v-if="row.source" :type="expectedUsageSourceTone(row.source)">
                {{ formatExpectedUsageSource(row.source) }}
              </ui-tag>
            </div>

            <span class="font-mono text-xs">{{ row.free }}</span>

            <span class="font-mono text-xs">{{ row.offGpus }}</span>

            <span class="font-mono text-xs" :class="{ 'text-error': row.systemMemoryShort }">
              {{ row.systemMemory }}
            </span>

            <div>
              <ui-tag :type="placementFitTone(row.fit)">{{ formatPlacementFit(row.fit) }}</ui-tag>
            </div>

            <span v-if="row.reason === null"></span>

            <template v-if="row.reason !== null" #expand>
              <div class="bg-inset" data-testid="placement-refusal">
                <p class="px-6 py-3 text-xs text-highlight">{{ row.reason }}</p>

                <ui-table
                  v-if="row.cards.length > 0 || row.poolSystemMemory !== null"
                  :columns="PLACEMENT_CARD_COLUMNS"
                  :min-width="640"
                  class="border-t border-divider"
                >
                  <ui-table-head>
                    <span>Card</span>
                    <span>Total</span>
                    <span>Used</span>
                    <span>Starting</span>
                    <span>Headroom</span>
                    <span>Free</span>
                  </ui-table-head>

                  <ui-table-row v-for="card of row.cards" :key="card.deviceKey" data-testid="placement-card-row">
                    <div class="min-w-0">
                      <div class="truncate font-mono text-xs text-header">{{ card.deviceKey }}</div>
                      <div v-if="card.name" class="mt-0.5 truncate text-xs text-muted">{{ card.name }}</div>
                    </div>

                    <span class="font-mono text-xs">{{ card.total }}</span>

                    <span class="font-mono text-xs">{{ card.used }}</span>

                    <span class="font-mono text-xs">{{ card.starting }}</span>

                    <span class="font-mono text-xs">{{ card.headroom }}</span>

                    <span class="font-mono text-xs">{{ card.free }}</span>
                  </ui-table-row>

                  <ui-table-row v-if="row.poolSystemMemory !== null" data-testid="placement-card-row">
                    <span class="truncate text-xs text-header">System memory</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">-</span>

                    <span class="font-mono text-xs">{{ row.poolSystemMemory }}</span>
                  </ui-table-row>
                </ui-table>
              </div>
            </template>
          </ui-table-row>
        </ui-table>
      </ui-card>

      <ui-card v-if="configuration" title="Settings in use" :subtitle="settingsSubtitle" flush>
        <mf-effective-configuration :configuration="configuration" :placement-nodes="placement?.nodes ?? []" />
      </ui-card>

      <ui-card
        title="Event log"
        subtitle="Events for this deployment, newest first."
        flush
        data-testid="event-log-card"
      >
        <mf-event-table
          :events="history"
          :columns="HISTORY_COLUMNS"
          :loading="loadingHistory"
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
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
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
  describeResidency,
  expectedUsageSourceTone,
  formatActivationPolicy,
  formatExpectedUsageSource,
  formatPlacementFit,
  placementFitTone,
  placementRows,
} from '@/utils/deployment';
import { formatDuration, formatRelativeDate } from '@/utils/format/date';
import { formatCount } from '@/utils/format/number';
import { describeCapacityNeed } from '@/utils/gpu';
import { countInstanceStates, formatInstanceState, instanceStateTone } from '@/utils/instance';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

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
  UiTag,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

interface IKpiFigures {
  value: string | number;
  unit?: string;
  bands: IKpiBand[];
  legend: IKpiLegendItem[];
}

const HISTORY_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary', 'actor'];

const PLACEMENT_COLUMNS = 'minmax(0, 1fr) 9rem 6rem 9.5rem 9rem 7.5rem 1rem';

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
const router = useRouter();
const dialogStore = useDialogStore();

const notificationStore = useNotificationStore();
const deploymentAdminService = useDeploymentAdminService();
const eventAdminService = useEventAdminService();
const instanceAdminService = useInstanceAdminService();

const deploymentId = computed(() =>
  typeof route.params.deploymentId === 'string' ? parseInt(route.params.deploymentId, 10) : null
);

const deployment = ref<DeploymentDto | null>(null);
const configuration = ref<DeploymentConfigurationDto | null>(null);
const instances = ref<ListInstanceDto[]>([]);
const placement = ref<InstancePlacementDto | null>(null);
const residency = ref<DeploymentResidencyDto | null>(null);

const loadingDeployment = ref(false);
const loadingInstances = ref(false);
const applying = ref(false);
const deleting = ref(false);
const updatingState = ref(false);
const starting = ref(false);
const stopping = ref(false);

const subscription = shallowRef<ISseSubscription | null>(null);
const eventSubscription = shallowRef<ISseSubscription | null>(null);

const running = computed(() => instances.value.length > 0);

const placementTable = computed(() => placementRows(placement.value?.nodes ?? []));

// The notice carries its own start, since `startable` counts a failed instance as its node's share.
const givenUp = computed(() => residency.value?.givenUp === true);

/** A node short of its replicas is one a start would act on, so a fully placed deployment offers nothing to do. */
const startable = computed(
  () =>
    deployment.value?.enabled === true &&
    (placement.value?.nodes ?? []).some(node => node.problem === null && node.running < node.replicas)
);

const residencyLine = computed(() =>
  residency.value === null
    ? 'The containers running this deployment.'
    : describeResidency(residency.value, running.value)
);

const settingsSubtitle = computed(() =>
  deployment.value?.presetName
    ? `Values from ${deployment.value.presetName}, plus this deployment's overrides.`
    : 'Values set on this deployment.'
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

const doStart = () => {
  if (deploymentId.value === null) {
    return;
  }

  starting.value = true;
  instanceAdminService
    .startDeployment(deploymentId.value)
    .then(started => {
      if (started.started > 0 && started.refused.length === 0) {
        notificationStore.addToast('Deployment started', `Started ${formatCount(started.started, 'instance')}.`);
      } else {
        const tone = started.started > 0 ? NotificationType.SUCCESS : NotificationType.WARNING;

        notificationStore.addNotification(new Notification(startedMessage(started), tone));
      }

      doGetInstances();
    })
    .finally(() => {
      starting.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doStart(): Failed to start this deployment');
    });
};

const startedMessage = (started: StartInstanceResponseDto): string => {
  const refusedNodes = started.refused
    .map(node => (node.capacity === null ? node.nodeName : `${node.nodeName} (${describeCapacityNeed(node.capacity)})`))
    .join(', ');

  if (started.started === 0) {
    return `No instances started. These nodes could not run an instance: ${refusedNodes}`;
  }

  return `Started ${formatCount(started.started, 'instance')}. These nodes could not run an instance: ${refusedNodes}`;
};

const confirmStop = () => {
  const id = deploymentId.value;

  if (id === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Stop ${deployment.value?.name ?? 'this deployment'}?`,
    message: 'Its backend containers are removed and their VRAM freed. Requests to this deployment will fail.',
    confirmLabel: 'Stop Deployment',
    action: () => doStop(id),
  });
};

const doStop = (id: number): Promise<void> => {
  stopping.value = true;

  return instanceAdminService
    .stopDeployment(id)
    .then(() => {
      notificationStore.addToast('Deployment stopped', 'Its containers are removed and their VRAM freed.');

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

const viewDeploymentList = () => {
  router.push('/deployments').catch((error: unknown) => {
    logger.error({ error }, 'viewDeploymentList(): Failed to navigate to deployment list');
  });
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

const confirmApply = () => {
  const target = deployment.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Apply changes to ${target.name}?`,
    message: 'Its instances restart one at a time with the current settings.',
    confirmLabel: 'Apply Changes',
    action: () => doApply(target.id),
  });
};

const doApply = (id: number): Promise<void> => {
  applying.value = true;

  return deploymentAdminService
    .applyDeployment(id)
    .then(() => {
      notificationStore.addToast('Changes applied', 'Instances restart one at a time.');

      doGetDeployment();
    })
    .finally(() => {
      applying.value = false;
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
      notificationStore.addToast(
        enabled ? 'Deployment enabled' : 'Deployment disabled',
        enabled ? 'The scheduler can start it again.' : 'Its instances stop once their requests finish.'
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
      notificationStore.addToast('Deployment deleted', `${target.name} no longer takes requests.`);

      viewDeploymentList();
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
