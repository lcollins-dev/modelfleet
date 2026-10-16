<template>
  <mf-meter
    :label="formatDownloadAmount(props.bytesDone, props.totalBytes)"
    :bands="[
      {
        label: formatDownloadState(props.state),
        tone: downloadStateBar(props.state),
        percent: downloadPercent(props.bytesDone, props.totalBytes),
      },
    ]"
  />
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import { DownloadState } from '@libs/dto';

import { downloadPercent, downloadStateBar, formatDownloadAmount, formatDownloadState } from '@/utils/download';

import MfMeter from '../Meter.vue';

const props = defineProps({
  bytesDone: {
    type: Number,
    required: true,
  },
  totalBytes: {
    type: Number,
    required: true,
  },
  state: {
    type: String as PropType<DownloadState>,
    required: true,
  },
});
</script>
