<template>
  <div class="bg-inset" data-testid="download-target-files">
    <ui-table :columns="COLUMNS" :scroll-label="`Files on ${props.nodeName}`">
      <ui-table-head sticky>
        <span>File</span>
        <span>State</span>
        <span>Progress</span>
        <span class="text-right">Done</span>
      </ui-table-head>

      <ui-table-row v-for="file of props.files" :key="file.path" dense data-testid="download-target-file">
        <mf-download-file-path :path="file.path" />

        <span class="whitespace-nowrap" :class="STATE_TEXT_CLASSES[downloadFileBar(file.state)]">
          {{ formatDownloadFileState(file.state) }}
        </span>

        <mf-meter
          :bands="[
            {
              label: formatDownloadFileState(file.state),
              tone: downloadFileBar(file.state),
              percent: downloadPercent(file.bytesDone, sizeOf(file.path)),
            },
          ]"
        />

        <span class="whitespace-nowrap text-right font-mono text-highlight">
          {{ formatDownloadAmount(file.bytesDone, sizeOf(file.path)) }}
        </span>
      </ui-table-row>
    </ui-table>
  </div>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import type { DownloadFileDto, DownloadTargetFileDto } from '@libs/dto';

import type { DownloadBarTone } from '@/utils/download';
import { downloadFileBar, downloadPercent, formatDownloadAmount, formatDownloadFileState } from '@/utils/download';

import { UiTable, UiTableHead, UiTableRow } from '@/components/ui';

import MfMeter from '../Meter.vue';
import MfDownloadFilePath from './FilePath.vue';

const COLUMNS = 'minmax(0, 1fr) 6rem 7rem 11rem';

const STATE_TEXT_CLASSES: Record<DownloadBarTone, string> = {
  primary: 'text-accent',
  success: 'text-success',
  error: 'text-error',
  muted: 'text-muted',
};

const props = defineProps({
  nodeName: {
    type: String,
    required: true,
  },
  files: {
    type: Array as PropType<DownloadTargetFileDto[]>,
    required: true,
  },
  downloadFiles: {
    type: Array as PropType<DownloadFileDto[]>,
    required: true,
  },
});

const sizeOf = (path: string): number => props.downloadFiles.find(file => file.path === path)?.sizeBytes ?? 0;
</script>
