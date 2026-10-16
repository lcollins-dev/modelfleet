<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Batch jobs"
      subtitle="Scheduled jobs registered on this system. Schedules run on the server's clock."
    />

    <ui-card flush>
      <ui-table :columns="TABLE_COLUMNS">
        <ui-table-head>
          <span>Job</span>
          <span>Last run</span>
          <span>Result</span>
          <span>Enabled</span>
          <span></span>
        </ui-table-head>

        <ui-table-row
          v-for="batchJob of batchJobList ?? []"
          :key="batchJob.id"
          :to="`/batch-jobs/${batchJob.id}`"
          data-testid="job-row"
        >
          <div class="min-w-0">
            <div class="font-medium text-header">{{ batchJob.name }}</div>
            <div class="mt-0.5 font-mono text-xs text-muted">{{ batchJob.cronExpression ?? 'Not scheduled' }}</div>
          </div>

          <span class="font-mono text-xs">
            {{ batchJob.lastStartDate === null ? 'Never' : formatDateTime(batchJob.lastStartDate) }}
          </span>

          <div>
            <ui-tag :type="JOB_RESULT_TAG_TYPES[jobResult(batchJob)]">
              {{ JOB_RESULT_LABELS[jobResult(batchJob)] }}
            </ui-tag>
          </div>

          <span @click.stop.prevent>
            <ui-switch
              :value="batchJob.enabled"
              :aria-label="`Run ${batchJob.name} on its schedule`"
              :loading="pendingId === batchJob.id"
              @update:value="enabled => doSetEnabled(batchJob, enabled)"
            />
          </span>

          <icon-chevron-right class="size-4 text-muted" />
        </ui-table-row>

        <template v-if="batchJobList?.length === 0" #empty>No batch jobs are registered.</template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { BatchJobDto } from '@libs/dto';

import { formatDateTime } from '@/utils/format/date';
import { JOB_RESULT_LABELS, JOB_RESULT_TAG_TYPES, jobResult } from '@/utils/jobResult';

import { useLogService } from '@/services/LogService';
import { useBatchJobAdminService } from '@/services/api/admin/BatchJobAdminService';
import { useNotificationStore } from '@/stores/notification';

import {
  UiCard,
  UiPageContainer,
  UiPageHeading,
  UiSwitch,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

import { useResource } from '@/composables/useResource';

const TABLE_COLUMNS = 'minmax(0, 1fr) 9rem 6rem 2.75rem 1.25rem';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/batch-jobs/Index');

const batchJobAdminService = useBatchJobAdminService();
const notificationStore = useNotificationStore();

const pendingId = ref<number | null>(null);

const { data: batchJobList } = useResource({
  request: {},
  fetch: () => batchJobAdminService.getBatchJobList().then(response => response.batchJobList),
});

const doSetEnabled = (batchJob: BatchJobDto, enabled: boolean) => {
  if (pendingId.value !== null) {
    return;
  }

  pendingId.value = batchJob.id;

  batchJobAdminService
    .updateBatchJobState({ enabled }, batchJob.id)
    .then(() => {
      batchJobList.value = (batchJobList.value ?? []).map(listed =>
        listed === batchJob ? { ...listed, enabled } : listed
      );

      notificationStore.addToast(
        enabled ? 'Job enabled' : 'Job disabled',
        enabled ? `${batchJob.name} runs on its schedule.` : `${batchJob.name} won't run until you enable it.`
      );
    })
    .finally(() => {
      pendingId.value = null;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doSetEnabled(): Failed to change the batch job state');
    });
};
</script>
