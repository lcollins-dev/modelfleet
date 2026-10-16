<template>
  <ui-page-container>
    <ui-page-heading v-if="download" back-to="/downloads" back-label="Downloads">
      <template #title>
        <span class="break-all font-mono">{{ download.repository }}</span>
      </template>

      <template #subtitle>{{ metaLine }}</template>

      <div class="flex flex-wrap items-center gap-3">
        <ui-button v-if="retryable && failedTargets.length === 0" :loading="loadingAction" @click="doRetry">
          <template #icon>
            <icon-refresh class="size-4" />
          </template>
          Retry
        </ui-button>

        <ui-button
          v-if="download.state === DownloadState.ACTIVE"
          type="danger-outline"
          :loading="loadingAction"
          data-testid="download-cancel"
          @click="confirmCancel"
        >
          Cancel Download
        </ui-button>

        <ui-button v-else :loading="loadingAction" @click="doDismiss">Dismiss</ui-button>
      </div>
    </ui-page-heading>

    <ui-back-link v-else to="/downloads" label="Downloads" />

    <div v-if="loadingDownload" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!download">
      <ui-empty>Could not load this download.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="failedTargets.length > 0" type="error" :title="failureTitle" data-testid="download-failure">
        <div v-for="target of failedTargets" :key="target.nodeId" class="break-words">
          <span v-if="failedTargets.length > 1" class="font-mono">{{ target.nodeName }}: </span>
          {{ target.message ?? 'The node gave no reason.' }}
        </div>

        <template v-if="retryable" #action>
          <ui-button type="primary" :loading="loadingAction" @click="doRetry">
            <template #icon>
              <icon-refresh class="size-4" />
            </template>
            Retry
          </ui-button>
        </template>
      </ui-notice>

      <ui-card title="Details" data-testid="download-details">
        <ui-stat-grid>
          <ui-stat label="State">
            <ui-tag :type="downloadStateTone(download.state)" data-testid="download-state">
              {{ formatDownloadState(download.state) }}
            </ui-tag>
          </ui-stat>

          <ui-stat v-for="entry of details" :key="entry.label" :label="entry.label" mono>
            <div v-for="line of entry.lines" :key="line" class="break-all">{{ line }}</div>
          </ui-stat>
        </ui-stat-grid>
      </ui-card>

      <ui-card
        title="Nodes"
        subtitle="Each node downloads its own copy and checks it before the scan catalogues it."
        flush
      >
        <ui-table :columns="targetColumns" :min-width="680">
          <ui-table-head>
            <span>Node</span>
            <span>State</span>
            <span>Progress</span>
            <span>Speed</span>
            <span>Time left</span>
            <span v-if="stoppableAlone"></span>
            <span v-if="expandable"></span>
          </ui-table-head>

          <ui-table-row v-for="target of download.targets" :key="target.nodeId" data-testid="download-target">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <ui-link
                  :to="`/nodes/${target.nodeId}`"
                  class="min-w-0 font-mono font-medium"
                  data-testid="download-target-node-link"
                  @click.stop
                >
                  <span class="truncate">{{ target.nodeName }}</span>
                </ui-link>

                <ui-tag v-if="target.nodeState !== NodeState.ONLINE" :type="nodeStateTone(target.nodeState)">
                  {{ formatNodeState(target.nodeState) }}
                </ui-tag>
              </div>

              <div
                v-if="describeDownloadTarget(target) !== null"
                class="mt-0.5 truncate text-xs"
                :class="target.state === DownloadTargetState.FAILED ? 'text-error' : 'text-muted'"
                :title="describeDownloadTarget(target) ?? undefined"
              >
                {{ describeDownloadTarget(target) }}
              </div>
            </div>

            <div>
              <ui-tag :type="downloadStateTone(downloadTargetState(target))">
                {{ formatDownloadState(downloadTargetState(target)) }}
              </ui-tag>
            </div>

            <mf-download-progress
              :bytes-done="target.bytesDone"
              :total-bytes="target.totalBytes"
              :state="downloadTargetState(target)"
            />

            <span class="font-mono text-xs">{{ formatDownloadSpeed(target) }}</span>

            <span class="font-mono text-xs">{{ formatDownloadTimeLeft(target) }}</span>

            <div v-if="stoppableAlone" class="flex justify-end">
              <ui-button
                v-if="target.state === DownloadTargetState.ACTIVE"
                type="text"
                :loading="stoppingNodeId === target.nodeId"
                @click.stop="doStop(target.nodeId)"
              >
                Stop
              </ui-button>
            </div>

            <template v-if="expandable" #expand>
              <div class="flex flex-col gap-1 bg-inset px-4 py-3 text-xs" data-testid="download-target-files">
                <div v-for="file of target.files" :key="file.path" class="flex justify-between gap-4">
                  <span class="truncate font-mono text-highlight">{{ file.path }}</span>

                  <span class="shrink-0 text-muted">
                    {{ formatDownloadFileState(file.state) }} ·
                    {{ formatDownloadAmount(file.bytesDone, sizeOf(file.path)) }}
                  </span>
                </div>

                <span v-if="target.files.length === 0" class="text-muted">
                  The node keeps no record of each file once it settles.
                </span>
              </div>
            </template>
          </ui-table-row>

          <template v-if="download.targets.length === 0" #empty>
            Every node this download named has since been deleted.
          </template>
        </ui-table>
      </ui-card>
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconRefresh from '~icons/material-symbols/refresh-rounded';

import type { DownloadDto, DownloadProgressDto, EventDto } from '@libs/dto';
import { DownloadState, DownloadTargetState, EventPartyType, EventType, NodeState } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import {
  describeDownloadTarget,
  downloadStateTone,
  downloadTargetState,
  formatDownloadAmount,
  formatDownloadFileState,
  formatDownloadSpeed,
  formatDownloadState,
  formatDownloadTimeLeft,
  withProgress,
} from '@/utils/download';
import { formatDateTime } from '@/utils/format/date';
import { formatBytes, formatCount } from '@/utils/format/number';
import { formatNodeState, nodeStateTone } from '@/utils/node';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useDownloadAdminService } from '@/services/api/admin/DownloadAdminService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import { MfDownloadProgress } from '@/components/mf';
import {
  UiBackLink,
  UiButton,
  UiCard,
  UiEmpty,
  UiLink,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiSpinner,
  UiStat,
  UiStatGrid,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

interface IDetailEntry {
  label: string;
  lines: string[];
}

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/downloads/Download');

const route = useRoute();
const router = useRouter();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();

const downloadAdminService = useDownloadAdminService();
const eventAdminService = useEventAdminService();

const downloadId = computed(() =>
  typeof route.params.downloadId === 'string' ? parseInt(route.params.downloadId, 10) : null
);

const stored = ref<DownloadDto | null>(null);
const progress = ref<DownloadProgressDto | undefined>(undefined);

const download = computed(() => (stored.value === null ? null : withProgress(stored.value, progress.value)));

const loadingDownload = ref(true);
const loadingAction = ref(false);
const stoppingNodeId = ref<number | null>(null);

const eventSubscription = shallowRef<ISseSubscription | null>(null);
const progressSubscription = shallowRef<ISseSubscription | null>(null);

const totalSize = computed(() => download.value?.files.reduce((sum, file) => sum + file.sizeBytes, 0) ?? 0);

const metaLine = computed(() => {
  if (download.value === null) {
    return '';
  }

  const nodes = download.value.targets.length;

  return `${formatBytes(totalSize.value)} · ${nodes === 1 ? download.value.targets[0].nodeName : formatCount(nodes, 'node')}`;
});

const details = computed<IDetailEntry[]>(() => {
  if (download.value === null) {
    return [];
  }

  return [
    { label: 'Repository', lines: [download.value.repository] },
    { label: 'Commit', lines: [download.value.revision] },
    { label: 'Destination', lines: [download.value.directory] },
    { label: 'Size per node', lines: [formatBytes(totalSize.value)] },
    { label: 'Started', lines: [formatDateTime(download.value.createdDate)] },
    { label: 'Started by', lines: [download.value.createdByName ?? 'A deleted user'] },
    { label: 'Files', lines: download.value.files.map(file => file.path) },
  ];
});

const failedTargets = computed(
  () => download.value?.targets.filter(target => target.state === DownloadTargetState.FAILED) ?? []
);

const failureTitle = computed(() => {
  const names = failedTargets.value.map(target => target.nodeName).join(', ');

  return failedTargets.value.length === 1 ? `The copy on ${names} failed` : `The copies on ${names} failed`;
});

const stoppableAlone = computed(() => (download.value?.targets.length ?? 0) > 1);

const expandable = computed(() => (download.value?.files.length ?? 0) > 1);

const targetColumns = computed(() =>
  [
    'minmax(0, 1fr) 7rem 12rem 6rem 5rem',
    ...(stoppableAlone.value ? ['4rem'] : []),
    ...(expandable.value ? ['1rem'] : []),
  ].join(' ')
);

/** Once no node is still downloading, any node that did not finish can be asked again. */
const retryable = computed(
  () =>
    download.value !== null &&
    download.value.state !== DownloadState.ACTIVE &&
    download.value.targets.some(
      target => target.state === DownloadTargetState.FAILED || target.state === DownloadTargetState.STOPPED
    )
);

const sizeOf = (path: string): number => download.value?.files.find(file => file.path === path)?.sizeBytes ?? 0;

const doGetDownload = () => {
  if (downloadId.value === null) {
    loadingDownload.value = false;

    return;
  }

  downloadAdminService
    .getDownload(downloadId.value)
    .then(received => {
      stored.value = received;
    })
    .finally(() => {
      loadingDownload.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetDownload(): Failed to get the download');
    });
};

const onLiveEvent = (event: EventDto) => {
  if (event.subjectType !== EventPartyType.DOWNLOAD || event.subjectId !== `${downloadId.value}`) {
    return;
  }

  // A dismissed download is gone, whoever dismissed it, so there is nothing left to read.
  if (event.type === EventType.DOWNLOAD_DISMISSED) {
    router.push('/downloads').catch((error: unknown) => {
      logger.error({ error }, 'onLiveEvent(): Failed to leave a dismissed download');
    });

    return;
  }

  doGetDownload();
};

const runAction = (action: () => Promise<void>, name: string) => {
  loadingAction.value = true;
  action()
    .finally(() => {
      loadingAction.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, `${name}(): Failed`);
    });
};

const doStop = (nodeId: number) => {
  if (downloadId.value === null) {
    return;
  }

  const id = downloadId.value;

  stoppingNodeId.value = nodeId;
  downloadAdminService
    .stopDownload(id, { nodeId })
    .finally(() => {
      stoppingNodeId.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doStop(): Failed to stop the download');
    });
};

const confirmCancel = () => {
  const id = downloadId.value;

  if (id === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Cancel the download of ${download.value?.repository ?? 'this repository'}?`,
    message: 'It cancels on every node. Partly written files are removed; finished ones stay.',
    confirmLabel: 'Cancel Download',
    action: () => {
      loadingAction.value = true;

      return downloadAdminService
        .stopDownload(id, {})
        .then(() => {
          notificationStore.addToast('Download cancelled', 'Partly written files were removed; finished ones stay.');
        })
        .finally(() => {
          loadingAction.value = false;
        });
    },
  });
};

const doRetry = () => {
  runAction(async () => {
    if (downloadId.value !== null) {
      await downloadAdminService.retryDownload(downloadId.value);

      notificationStore.addToast('Download restarted', `${download.value?.repository ?? 'It'} is downloading again.`);
    }
  }, 'doRetry');
};

const doDismiss = () => {
  runAction(async () => {
    if (downloadId.value !== null) {
      await downloadAdminService.dismissDownload(downloadId.value);
      await router.push('/downloads');
    }
  }, 'doDismiss');
};

watch(downloadId, () => {
  doGetDownload();
});

onMounted(() => {
  doGetDownload();

  eventSubscription.value = eventAdminService.streamEvents(onLiveEvent, doGetDownload);
  progressSubscription.value = downloadAdminService.streamDownloadProgress(response => {
    progress.value = response.downloads.find(entry => entry.key === stored.value?.key);
  });
});

onBeforeUnmount(() => {
  eventSubscription.value?.close();
  progressSubscription.value?.close();
});
</script>
