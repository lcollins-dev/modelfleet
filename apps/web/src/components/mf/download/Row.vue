<template>
  <ui-table-row :to="props.to" data-testid="download">
    <div class="min-w-0">
      <div class="truncate font-mono font-medium text-header">{{ props.download.repository }}</div>
      <div class="mt-0.5 truncate text-xs text-muted">{{ description }}</div>
    </div>

    <div>
      <ui-tag :type="downloadStateTone(props.download.state)">{{ formatDownloadState(props.download.state) }}</ui-tag>
    </div>

    <span class="font-mono text-xs" :title="nodeNames">{{ props.download.targets.length }}</span>

    <mf-download-progress
      :bytes-done="props.download.bytesDone"
      :total-bytes="props.download.totalBytes"
      :state="props.download.state"
    />

    <icon-chevron-right class="size-4 text-muted" />
  </ui-table-row>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { DownloadDto } from '@libs/dto';

import { downloadStateTone, formatDownloadState, summariseDownload } from '@/utils/download';
import { formatCount } from '@/utils/format/number';

import { UiTableRow, UiTag } from '@/components/ui';

import MfDownloadProgress from './Progress.vue';

const props = defineProps({
  download: {
    type: Object as PropType<DownloadDto>,
    required: true,
  },
  to: {
    type: String,
    default: undefined,
  },
});

const description = computed(
  () => `${summariseDownload(props.download)} · ${formatCount(props.download.files.length, 'file')}`
);

const nodeNames = computed(() => props.download.targets.map(target => target.nodeName).join(', '));
</script>
