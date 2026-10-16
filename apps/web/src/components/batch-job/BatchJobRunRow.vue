<template>
  <ui-table-row data-testid="job-run">
    <span class="font-mono text-xs">{{ formatDateTime(props.batchJobRun.startDate) }}</span>

    <span class="font-mono text-xs">{{ duration }}</span>

    <div>
      <ui-tag :type="JOB_RUN_RESULT_TAG_TYPES[props.batchJobRun.result]">
        {{ JOB_RUN_RESULT_LABELS[props.batchJobRun.result] }}
      </ui-tag>
    </div>

    <span v-if="props.batchJobRun.error === null"></span>

    <template v-if="props.batchJobRun.error !== null" #expand>
      <ui-code block tone="error" data-testid="job-run-error">{{ props.batchJobRun.error }}</ui-code>
    </template>
  </ui-table-row>
</template>

<script setup lang="ts">
import { computed, PropType } from 'vue';

import type { BatchJobRunDto } from '@libs/dto';

import { formatDateTime, formatDuration } from '@/utils/format/date';
import { JOB_RUN_RESULT_LABELS, JOB_RUN_RESULT_TAG_TYPES } from '@/utils/jobResult';

import { UiCode, UiTableRow, UiTag } from '@/components/ui';

/** Place inside a UiTable with four columns: Started, Duration, Result and the expand toggle. */
const props = defineProps({
  batchJobRun: {
    type: Object as PropType<BatchJobRunDto>,
    required: true,
  },
});

const duration = computed(() =>
  props.batchJobRun.endDate === null
    ? '-'
    : formatDuration((props.batchJobRun.endDate.getTime() - props.batchJobRun.startDate.getTime()) / 1000)
);
</script>
