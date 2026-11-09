<template>
  <ui-page-container wide>
    <ui-page-heading v-if="node">
      <template #title>
        <span class="font-mono">{{ node.name }}</span>
      </template>

      <ui-button @click="openEditModal">
        <template #icon>
          <icon-edit class="size-4" />
        </template>
        Edit
      </ui-button>
    </ui-page-heading>

    <ui-back-link v-else />

    <div v-if="loadingNode && !node" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!node">
      <ui-empty>Could not load this node.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="node.state === NodeState.REGISTERED" type="info" title="Awaiting first contact">
        The agent has not connected yet. Start it with the credentials issued during registration.
      </ui-notice>

      <ui-notice v-if="!node.enabled" type="warning" title="Disabled">
        The scheduler places nothing on this node until you enable it again.

        <template #action>
          <ui-button type="primary" :loading="pending === 'state'" :disabled="pending !== null" @click="doEnable">
            Enable Node
          </ui-button>
        </template>
      </ui-notice>

      <ui-notice v-if="telemetryErrors.length > 0" type="warning" title="Telemetry is degraded">
        <ul class="m-0 flex flex-col gap-1 pl-5">
          <li v-for="(error, index) of telemetryErrors" :key="index">{{ error.message }}</li>
        </ul>
      </ui-notice>

      <div
        v-if="hostKpis"
        class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4"
        data-testid="host-kpis"
      >
        <mf-kpi-tile label="CPU" :icon="IconDeveloperBoard" v-bind="hostKpis.cpu" :stale="telemetryStale" />

        <mf-kpi-tile
          label="RAM"
          :icon="IconStorage"
          v-bind="hostKpis.memory"
          :detail="memoryMeter?.detail"
          :stale="telemetryStale"
        >
          <template v-if="memoryMeter" #meter>
            <mf-meter :bands="memoryMeter.bands" legend />
          </template>
        </mf-kpi-tile>

        <mf-kpi-tile
          label="Model storage"
          :icon="IconHardDrive"
          v-bind="hostKpis.storage"
          :detail="storageMeter?.detail"
          :stale="telemetryStale"
        >
          <template v-if="storageMeter" #meter>
            <mf-meter :bands="storageMeter.bands" legend />
          </template>
        </mf-kpi-tile>
      </div>

      <ui-card title="Details">
        <ui-stat-grid>
          <ui-stat label="State">
            <ui-tag :type="nodeStateTone(node.state)" data-testid="node-state">{{
              formatNodeState(node.state)
            }}</ui-tag>
          </ui-stat>
          <ui-stat label="Node key" mono>{{ node.nodeKey }}</ui-stat>
          <ui-stat label="Last heartbeat">
            {{ node.lastSeenDate === null ? 'Never' : formatRelativeDate(node.lastSeenDate) }}
          </ui-stat>
          <ui-stat label="Agent version" mono>{{ node.agentVersion ?? '-' }}</ui-stat>
          <ui-stat label="Telemetry">{{ formatTelemetryState(telemetryStatus?.telemetryState ?? null) }}</ui-stat>
          <ui-stat label="Registered">{{ formatDate(node.createdDate) }}</ui-stat>
        </ui-stat-grid>
      </ui-card>

      <ui-card title="GPUs" subtitle="Memory on each device, by owner." flush data-testid="gpus-card">
        <template #header-extra>
          <mf-gpu-attribution-tag :devices="devices" />
        </template>

        <template v-if="devices.length > 0">
          <mf-gpu-device-row
            v-for="device of devices"
            :key="device.deviceKey"
            :device="device"
            :headroom-bytes="telemetryStatus?.headroomBytes"
          />
        </template>

        <div v-else-if="loadingTelemetry" class="flex justify-center py-8">
          <ui-spinner />
        </div>

        <ui-empty v-else>{{ deviceEmptyDescription }}</ui-empty>
      </ui-card>

      <ui-card title="Instances" subtitle="Instances placed on this node." flush data-testid="instances-card">
        <mf-instance-table
          :instances="instances"
          party="deployment"
          :loading="loadingInstances"
          :vram-by-instance="vramByInstance"
          :resident-bytes-by-instance="residentBytesByInstance"
          empty-description="No Modelfleet instances are running on this node. Start one from its deployment."
        />
      </ui-card>

      <ui-card title="Models" subtitle="Weights found in this node's folders." flush data-testid="models-card">
        <template #header-extra>
          <ui-button :loading="pending === 'scan'" @click="doScanModels">
            <template #icon>
              <icon-refresh class="size-4" />
            </template>
            Rescan
          </ui-button>
        </template>

        <ui-table :columns="MODEL_COLUMNS" :min-width="480">
          <ui-table-head>
            <span>Model</span>
            <span>Size</span>
            <span></span>
          </ui-table-head>

          <ui-table-row
            v-for="nodeModel of nodeModels"
            :key="nodeModel.id"
            :to="`/models/${nodeModel.id}`"
            data-testid="model-row"
          >
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-mono font-medium text-header">{{ modelLabel(nodeModel) }}</span>

                <ui-tag v-if="companionLabel(nodeModel.type)">{{ companionLabel(nodeModel.type) }}</ui-tag>
              </div>

              <div class="mt-0.5 truncate text-xs text-muted">{{ formatModelKind(nodeModel) }}</div>
            </div>

            <span class="font-mono text-xs">{{ formatBytes(nodeModel.sizeBytes) }}</span>

            <icon-chevron-right class="size-4 text-muted" />
          </ui-table-row>

          <template v-if="!loadingInventory && nodeModels.length === 0" #empty>
            No models are stored on this node yet.
          </template>
        </ui-table>
      </ui-card>

      <ui-card title="Event log" subtitle="Events for this node." flush data-testid="event-log-card">
        <mf-event-table
          :events="history"
          :columns="HISTORY_COLUMNS"
          :loading="loadingHistory"
          empty-description="No events have been recorded for this node yet."
        />

        <template v-if="historyPages > 1" #footer>
          <ui-pagination v-model:page="historyPage" :page-count="historyPages" />
        </template>
      </ui-card>

      <mf-danger-card
        v-if="node.enabled"
        label="Disable node"
        :help="`The scheduler stops placing instances on ${node.name} until you enable it again.`"
        action-label="Disable Node"
        :loading="pending === 'state'"
        :disabled="pending !== null"
        @action="confirmDisable"
      >
        <ui-form-field layout="row" align="end" label="Delete node" :help="DELETE_HELP">
          <ui-button type="danger-outline" :disabled="pending !== null" @click="confirmDelete">Delete Node</ui-button>
        </ui-form-field>
      </mf-danger-card>

      <mf-danger-card
        v-else
        label="Delete node"
        :help="DELETE_HELP"
        action-label="Delete Node"
        :disabled="pending !== null"
        @action="confirmDelete"
      />
    </template>

    <ui-modal v-model:show="showEditModal" class="max-w-md" :title="`Edit ${node?.name ?? 'node'}`">
      <ui-form :name="EDIT_FORM" @submit="doUpdateNode">
        <ui-form-field v-slot="{ input }" label="Name" help="Lowercase letters, numbers, dashes and dots." path="name">
          <ui-input v-model:value="nameField" v-bind="input" name="node-name" autocomplete="off" />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          label="Description"
          help="Optional. Where it is, or what it is for."
          path="description"
        >
          <ui-input
            v-model:value="descriptionField"
            v-bind="input"
            name="node-description"
            autocomplete="off"
            placeholder="Rack 1, DC1"
          />
        </ui-form-field>

        <div class="flex justify-end gap-2">
          <ui-button @click="showEditModal = false">Cancel</ui-button>

          <ui-button type="primary" native-type="submit" :loading="pending === 'update'">Save Changes</ui-button>
        </div>
      </ui-form>
    </ui-modal>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';
import IconDeveloperBoard from '~icons/material-symbols/developer-board-outline-rounded';
import IconEdit from '~icons/material-symbols/edit-outline-rounded';
import IconHardDrive from '~icons/material-symbols/hard-drive-outline-rounded';
import IconRefresh from '~icons/material-symbols/refresh-rounded';
import IconStorage from '~icons/material-symbols/storage-rounded';

import type {
  EventDto,
  EventFilterRequestDto,
  ListInstanceDto,
  NodeDto,
  NodeHostTelemetryDto,
  NodeInstancesResponseDto,
  NodeModelDto,
  NodeTelemetryStatusDto,
} from '@libs/dto';
import { EventPartyType, EventType, NodeState } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { formatDate, formatRelativeDate } from '@/utils/format/date';
import { formatBytes } from '@/utils/format/number';
import { formatTelemetryState, usageTone } from '@/utils/gpu';
import { companionLabel, formatModelKind, modelLabel } from '@/utils/model';
import { formatNodeState, nodeStateTone } from '@/utils/node';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useModelAdminService } from '@/services/api/admin/ModelAdminService';
import { useNodeAdminService } from '@/services/api/admin/NodeAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useTelemetryStore } from '@/stores/telemetry';

import {
  EventTableColumn,
  IKpiBand,
  IKpiLegendItem,
  IMeterBand,
  MeterTone,
  MfDangerCard,
  MfEventTable,
  MfGpuAttributionTag,
  MfGpuDeviceRow,
  MfInstanceTable,
  MfKpiTile,
  MfMeter,
  PROCESS_METER_TONES,
  STATUS_METER_TONES,
} from '@/components/mf';
import {
  UiBackLink,
  UiButton,
  UiCard,
  UiEmpty,
  UiForm,
  UiFormField,
  UiInput,
  UiModal,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiSpinner,
  UiStat,
  UiStatGrid,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

import { useGoBack } from '@/composables/useGoBack';
import { usePage } from '@/composables/usePage';
import { usePagedList } from '@/composables/usePagedList';

interface IKpiFigures {
  value: string | number;
  unit?: string;
  bands?: IKpiBand[];
  legend?: IKpiLegendItem[];
}

interface IMemoryOwner {
  label: string;
  residentBytes: number;
  mappedBytes: number;
  tone: MeterTone;
}

interface IStorageFolder {
  path: string;
  freeBytes: number;
  totalBytes: number;
}

type PendingAction = 'update' | 'state' | 'scan' | 'delete';

const HISTORY_COLUMNS: EventTableColumn[] = ['when', 'event', 'summary', 'actor'];

const MODEL_COLUMNS = 'minmax(0, 1fr) 6rem 1rem';

const EDIT_FORM = 'update-node';

const DELETE_HELP = 'Its credentials are removed. Register the node again before its agent can reconnect.';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/nodes/Node');

const route = useRoute();
const { goBack } = useGoBack();

const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const telemetryStore = useTelemetryStore();

const nodeAdminService = useNodeAdminService();
const eventAdminService = useEventAdminService();
const modelAdminService = useModelAdminService();
const telemetryAdminService = useTelemetryAdminService();
const instanceAdminService = useInstanceAdminService();

const nodeId = computed(() => (typeof route.params.nodeId === 'string' ? parseInt(route.params.nodeId, 10) : null));

const node = ref<NodeDto | null>(null);

usePage({ title: () => node.value?.name ?? '', subtitle: () => node.value?.description ?? undefined, back: '/nodes' });

const nameField = ref('');
const descriptionField = ref('');
const showEditModal = ref(false);
const telemetryStatus = ref<NodeTelemetryStatusDto | null>(null);
const nodeModels = ref<NodeModelDto[]>([]);
const instances = ref<ListInstanceDto[]>([]);

const loadingNode = ref(false);
const loadingTelemetry = ref(false);
const loadingInventory = ref(false);
const loadingInstances = ref(false);
const pending = ref<PendingAction | null>(null);

const subscription = shallowRef<ISseSubscription | null>(null);
const telemetrySubscription = shallowRef<ISseSubscription | null>(null);
const instanceSubscription = shallowRef<ISseSubscription | null>(null);

const telemetryErrors = computed(() => telemetryStatus.value?.errors ?? []);

const telemetryStale = computed(() => telemetryStore.stateOf(telemetrySubscription.value) === 'stale');

const devices = computed(() => telemetryStatus.value?.devices ?? []);

const cpuOnly = computed(
  () => telemetryStatus.value !== null && devices.value.length === 0 && telemetryStatus.value.telemetryState !== null
);

const deviceEmptyDescription = computed(() => {
  if (telemetryStatus.value === null) {
    return 'Could not load the devices on this node.';
  }

  return cpuOnly.value
    ? 'This node has no GPUs. It will run CPU-only workloads.'
    : 'This node has not reported its devices yet.';
});

const vramByInstance = computed(() => {
  const held: Record<string, number> = {};

  for (const process of devices.value.flatMap(device => device.processes)) {
    if (process.instanceKey !== null && process.usedBytes !== null) {
      held[process.instanceKey] = (held[process.instanceKey] ?? 0) + process.usedBytes;
    }
  }

  return held;
});

const residentBytesByInstance = computed(() => {
  const resident: Record<string, number | null> = {};

  for (const reading of telemetryStatus.value?.host?.instanceMemory ?? []) {
    resident[reading.instanceKey] = reading.residentBytes;
  }

  return resident;
});

const percentOf = (part: number, whole: number): number => Math.round((part / whole) * 100);

const cpuLegend = (host: NodeHostTelemetryDto): IKpiLegendItem[] => {
  const cores = host.cpuCount > 0 ? `${host.cpuCount} ${host.cpuCount === 1 ? 'core' : 'cores'}` : 'Cores not reported';

  return host.cpuModel === null ? [{ label: cores }] : [{ label: cores }, { label: host.cpuModel }];
};

const cpuKpi = (host: NodeHostTelemetryDto): IKpiFigures => {
  const legend = cpuLegend(host);

  if (host.loadAverage1m === null || host.cpuCount === 0) {
    return { value: '-', unit: '1-minute average', legend };
  }

  const percent = Math.min(100, percentOf(host.loadAverage1m, host.cpuCount));
  const fill = STATUS_METER_TONES[usageTone(percent)];

  return {
    value: host.loadAverage1m.toFixed(2),
    unit: '1-minute average',
    bands: [{ tone: fill, percent }, { percent: 100 - percent }],
    legend,
  };
};

const memoryKpi = (host: NodeHostTelemetryDto): IKpiFigures => {
  if (host.memoryTotalBytes === 0) {
    return { value: '-', legend: [{ label: 'Not reported' }] };
  }

  const usedBytes = host.memoryTotalBytes - host.memoryFreeBytes;

  return {
    value: formatBytes(usedBytes + shownHeldBytes(host)),
    unit: `of ${formatBytes(host.memoryTotalBytes)}`,
  };
};

// Two instances mapping one file count twice, so what is held can exceed what the kernel calls free.
const shownHeldBytes = (host: NodeHostTelemetryDto): number => Math.min(host.heldByModelsBytes, host.memoryFreeBytes);

const memoryOwners = (
  host: NodeHostTelemetryDto
): { owners: IMemoryOwner[]; unknown: string[]; unmatchedMappedBytes: number } => {
  const deployments = new Map<string, { residentBytes: number; mappedBytes: number }>();
  const unknown = new Set<string>();

  let unmatchedMappedBytes = 0;

  for (const { instanceKey, heldBytes, residentBytes } of host.instanceMemory) {
    const deploymentName = instances.value.find(candidate => candidate.instanceKey === instanceKey)?.deploymentName;

    if (residentBytes === null) {
      unknown.add(deploymentName ?? 'Models');
    } else if (deploymentName === undefined) {
      unmatchedMappedBytes += heldBytes ?? 0;
    } else {
      const deployment = deployments.get(deploymentName) ?? { residentBytes: 0, mappedBytes: 0 };

      deployment.residentBytes += residentBytes;
      deployment.mappedBytes += heldBytes ?? 0;

      deployments.set(deploymentName, deployment);
    }
  }

  const owners = [...deployments].map(
    ([label, figures], index): IMemoryOwner => ({
      label,
      ...figures,
      tone: PROCESS_METER_TONES[index % PROCESS_METER_TONES.length],
    })
  );

  if (host.heldByModelsUnknown && host.instanceMemory.length === 0) {
    unknown.add('Models');
  }

  return { owners, unknown: [...unknown], unmatchedMappedBytes };
};

const modelStorage = computed(() => {
  const folders: IStorageFolder[] = [];
  const unread: string[] = [];
  const counted = new Set<string>();

  for (const { path, freeBytes, totalBytes } of telemetryStatus.value?.host?.modelDirectories ?? []) {
    if (freeBytes === null || totalBytes === null) {
      unread.push(path);
    } else if (!counted.has(`${freeBytes}/${totalBytes}`)) {
      // Folders on one filesystem report the same pair and the DTO has no filesystem id, so the pair counts once.
      counted.add(`${freeBytes}/${totalBytes}`);
      folders.push({ path, freeBytes, totalBytes });
    }
  }

  const totalBytes = folders.reduce((total, folder) => total + folder.totalBytes, 0);
  const freeBytes = folders.reduce((total, folder) => total + folder.freeBytes, 0);

  return totalBytes === 0 ? null : { folders, unread, totalBytes, freeBytes };
});

const storageKpi = (): IKpiFigures => {
  if (modelStorage.value === null) {
    return { value: '-', legend: [{ label: 'Not reported' }] };
  }

  const { totalBytes, freeBytes } = modelStorage.value;

  return { value: formatBytes(totalBytes - freeBytes), unit: `of ${formatBytes(totalBytes)}` };
};

const hostKpis = computed(() => {
  const host = telemetryStatus.value?.host ?? null;

  return host === null ? null : { cpu: cpuKpi(host), memory: memoryKpi(host), storage: storageKpi() };
});

const memoryMeter = computed(() => {
  const host = telemetryStatus.value?.host ?? null;

  if (host === null || host.memoryTotalBytes === 0) {
    return null;
  }

  const barPercent = (bytes: number): number => (bytes / host.memoryTotalBytes) * 100;

  const usedBytes = host.memoryTotalBytes - host.memoryFreeBytes;
  const heldBytes = shownHeldBytes(host);

  const { owners, unknown, unmatchedMappedBytes } = memoryOwners(host);
  const mappedBytes = owners.reduce((total, owner) => total + owner.mappedBytes, unmatchedMappedBytes);
  const anonymousBytes = owners.reduce((total, owner) => total + owner.residentBytes - owner.mappedBytes, 0);
  const mappedShare = mappedBytes > heldBytes ? heldBytes / mappedBytes : 1;

  // Processes are read a moment after the kernel's figure, so anonymous memory can briefly pass used.
  const anonymousShare = anonymousBytes > usedBytes ? usedBytes / anonymousBytes : 1;

  const otherUsedBytes = Math.max(usedBytes - anonymousBytes, 0);

  const bands: IMeterBand[] = [
    ...owners.map(owner => ({
      label: owner.label,
      tone: owner.tone,
      value: formatBytes(owner.residentBytes),
      percent: barPercent((owner.residentBytes - owner.mappedBytes) * anonymousShare + owner.mappedBytes * mappedShare),
    })),
    ...unknown.map((label): IMeterBand => ({ label, tone: 'muted', value: 'Unknown', percent: 0 })),
    {
      label: 'Other',
      tone: 'muted',
      value: formatBytes(otherUsedBytes + unmatchedMappedBytes),
      percent: barPercent(otherUsedBytes + unmatchedMappedBytes * mappedShare),
    },
  ];

  return {
    detail: `${host.heldByModelsUnknown ? 'At most ' : ''}${formatBytes(host.memoryAvailableBytes)} free`,
    bands,
  };
});

const storageMeter = computed(() => {
  if (modelStorage.value === null) {
    return null;
  }

  const { folders, unread, totalBytes, freeBytes } = modelStorage.value;

  const bands: IMeterBand[] = [
    ...folders.map((folder, index) => ({
      label: folder.path,
      tone: PROCESS_METER_TONES[index % PROCESS_METER_TONES.length],
      value: formatBytes(folder.totalBytes - folder.freeBytes),
      percent: ((folder.totalBytes - folder.freeBytes) / totalBytes) * 100,
    })),
    ...unread.map((label): IMeterBand => ({ label, tone: 'muted', value: 'Unknown', percent: 0 })),
  ];

  return { detail: `${unread.length > 0 ? 'At least ' : ''}${formatBytes(freeBytes)} free`, bands };
});

const doGetNode = () => {
  if (nodeId.value === null) {
    return;
  }

  loadingNode.value = true;
  nodeAdminService
    .getNode(nodeId.value)
    .then(nodeResponse => {
      node.value = nodeResponse;
    })
    .finally(() => {
      loadingNode.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetNode(): Failed to get node');
    });
};

const historyRequest = computed<EventFilterRequestDto | null>(() =>
  nodeId.value === null ? null : { subjectType: EventPartyType.NODE, subjectId: `${nodeId.value}` }
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

const doGetTelemetryStatus = () => {
  if (nodeId.value === null) {
    return;
  }

  loadingTelemetry.value = true;
  telemetryAdminService
    .getNodeTelemetryStatus(nodeId.value)
    .then(status => {
      telemetryStatus.value = status;
    })
    .finally(() => {
      loadingTelemetry.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetTelemetryStatus(): Failed to get node telemetry status');
    });
};

const doGetModelInventory = () => {
  if (nodeId.value === null) {
    return;
  }

  loadingInventory.value = true;
  modelAdminService
    .getNodeModelInventory(nodeId.value)
    .then(inventory => {
      nodeModels.value = inventory.models;
    })
    .finally(() => {
      loadingInventory.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetModelInventory(): Failed to get the models this node holds');
    });
};

const doGetInstances = () => {
  if (nodeId.value === null) {
    return;
  }

  loadingInstances.value = true;
  instanceAdminService
    .getNodeInstances(nodeId.value)
    .then(response => {
      instances.value = response.instances;
    })
    .finally(() => {
      loadingInstances.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetInstances(): Failed to get the instances resident on this node');
    });
};

const doScanModels = () => {
  if (node.value === null || pending.value !== null) {
    return;
  }

  const target = node.value;

  pending.value = 'scan';
  modelAdminService
    .scanNodeModels(target.id)
    .then(() => {
      notificationStore.addToast('Rescan started', `${target.name} is checking its weights folders.`);
    })
    .finally(() => {
      pending.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doScanModels(): Failed to ask this node to rescan');
    });
};

const openEditModal = () => {
  nameField.value = node.value?.name ?? '';
  descriptionField.value = node.value?.description ?? '';

  showEditModal.value = true;
};

const doUpdateNode = () => {
  if (node.value === null || pending.value !== null) {
    return;
  }

  pending.value = 'update';
  nodeAdminService
    .updateNode({ name: nameField.value.trim(), description: descriptionField.value.trim() }, node.value.id, EDIT_FORM)
    .then(() => {
      showEditModal.value = false;

      notificationStore.addToast('Node updated', `${nameField.value.trim()} is saved.`);

      doGetNode();
    })
    .finally(() => {
      pending.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doUpdateNode(): Failed to update node');
    });
};

const doUpdateState = (enabled: boolean): Promise<void> => {
  const target = node.value;

  if (target === null) {
    return Promise.resolve();
  }

  pending.value = 'state';

  return nodeAdminService
    .updateState({ enabled }, target.id)
    .then(() => {
      notificationStore.addToast(
        enabled ? 'Node enabled' : 'Node disabled',
        enabled ? `${target.name} can receive new instances.` : `${target.name} won't receive new instances.`
      );

      doGetNode();
    })
    .finally(() => {
      pending.value = null;
    });
};

const doEnable = () => {
  if (pending.value !== null) {
    return;
  }

  doUpdateState(true).catch((error: unknown) => {
    logger.error({ error }, 'doEnable(): Failed to enable the node');
  });
};

const confirmDisable = () => {
  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Disable ${node.value?.name ?? 'this node'}?`,
    message: 'The scheduler stops placing instances on it until you enable it again.',
    confirmLabel: 'Disable Node',
    action: () => doUpdateState(false),
  });
};

const confirmDelete = () => {
  const target = node.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Delete ${target.name}?`,
    message: DELETE_HELP,
    confirmLabel: 'Delete Node',
    action: () => doDeleteNode(target),
  });
};

const doDeleteNode = (target: NodeDto): Promise<void> => {
  pending.value = 'delete';

  return nodeAdminService
    .deleteNode(target.id)
    .then(() => {
      notificationStore.addToast('Node deleted', `${target.name} is removed from the fleet.`);

      goBack({ replace: true });
    })
    .finally(() => {
      pending.value = null;
    });
};

const onLiveEvent = (event: EventDto) => {
  if (event.subjectType === EventPartyType.MODEL) {
    doGetModelInventory();

    return;
  }

  // The deleted event arrives after the row is gone, so a reread would answer not found.
  if (
    event.subjectType !== EventPartyType.NODE ||
    event.subjectId !== `${nodeId.value ?? ''}` ||
    event.type === EventType.NODE_DELETED
  ) {
    return;
  }

  doGetNode();
  refreshHistory();
};

const onReconnect = () => {
  doGetNode();
  refreshHistory();
  doGetModelInventory();
};

const onTelemetryStatus = (status: NodeTelemetryStatusDto) => {
  telemetryStatus.value = status;
  loadingTelemetry.value = false;
};

const onNodeInstances = (response: NodeInstancesResponseDto) => {
  instances.value = response.instances;
};

watchEffect(() => {
  doGetNode();
  doGetTelemetryStatus();
  doGetModelInventory();
  doGetInstances();
});

watchEffect(onCleanup => {
  if (nodeId.value === null) {
    return;
  }

  telemetrySubscription.value = telemetryAdminService.streamNodeTelemetryStatus(nodeId.value, onTelemetryStatus);
  instanceSubscription.value = instanceAdminService.streamNodeInstances(nodeId.value, onNodeInstances);

  onCleanup(() => {
    telemetrySubscription.value?.close();
    telemetrySubscription.value = null;

    instanceSubscription.value?.close();
    instanceSubscription.value = null;
  });
});

onMounted(() => {
  subscription.value = eventAdminService.streamEvents(onLiveEvent, onReconnect);
});

onBeforeUnmount(() => {
  subscription.value?.close();
  telemetrySubscription.value?.close();
  instanceSubscription.value?.close();
});
</script>
