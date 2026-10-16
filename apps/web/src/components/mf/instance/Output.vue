<template>
  <ui-card title="Output" flush data-testid="instance-output">
    <template #subtitle>
      <span data-testid="output-span">{{
        span ?? (props.waiting ? 'Waiting for the container' : 'Reading the latest lines')
      }}</span>
    </template>

    <template #header-extra>
      <ui-tag :type="status.type" data-testid="output-status">{{ status.label }}</ui-tag>
    </template>

    <div class="relative h-full min-h-48">
      <div
        ref="pane"
        class="absolute inset-0 overflow-y-auto bg-inset px-4 py-3 font-mono text-xs leading-relaxed"
        data-testid="output-pane"
        @scroll="onScroll"
      >
        <div v-if="props.output.dropped > 0" class="mb-1 text-muted" data-testid="output-dropped">
          Older lines dropped, to keep the last {{ formatNumber(OUTPUT_LINE_CAP) }}.
        </div>

        <div
          v-for="line of props.output.lines"
          :key="line.id"
          class="grid grid-cols-[8ch_minmax(0,1fr)] gap-x-4.5"
          data-testid="output-line"
        >
          <span class="select-none text-muted" :title="line.date === null ? undefined : formatDateTime(line.date)">
            {{ line.date === null ? '' : formatTime(line.date) }}
          </span>

          <div class="min-w-0 wrap-anywhere">
            <mf-instance-output-text :segments="line.segments" class="whitespace-pre-wrap text-highlight" />

            <span v-if="line.cut" class="ml-1.5 select-none text-muted" data-testid="output-cut">[cut]</span>
          </div>
        </div>

        <div v-if="props.waiting" class="text-muted" data-testid="output-waiting">
          The node holds no container for this instance yet, as it may still be pulling the image. Trying again every
          few seconds.
        </div>

        <div
          v-if="props.output.tailLines !== null && props.output.lines.length === 0 && props.output.ended === null"
          class="text-muted"
        >
          No output yet.
        </div>

        <div
          v-if="props.output.ended === InstanceOutputEndReason.EXITED"
          class="mt-1 text-muted"
          data-testid="output-ended"
        >
          The output ended, since the container exited or was removed.
        </div>

        <ui-notice
          v-if="props.output.ended === InstanceOutputEndReason.LOST"
          type="warning"
          title="The connection to the node was lost"
          class="mt-3 font-sans"
          data-testid="output-lost"
        >
          The output stops at the last line above. Reconnect to read the latest lines again.

          <template #action>
            <ui-button @click="emit('reconnect')">Reconnect</ui-button>
          </template>
        </ui-notice>
      </div>

      <div v-if="!following" class="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <ui-button type="primary" class="pointer-events-auto shadow-sm" data-testid="output-jump" @click="follow">
          <template #icon>
            <icon-arrow-downward class="size-4" />
          </template>
          Jump to latest
          <template v-if="missed > 0"> <span aria-hidden="true">·</span> {{ formatNumber(missed) }} new </template>
        </ui-button>
      </div>
    </div>
  </ui-card>
</template>

<script setup lang="ts">
import { PropType, computed, ref, useTemplateRef, watch } from 'vue';
import IconArrowDownward from '~icons/material-symbols/arrow-downward-rounded';

import { InstanceOutputEndReason } from '@libs/dto';

import { formatDateTime, formatTime } from '@/utils/format/date';
import { formatNumber } from '@/utils/format/number';
import { IInstanceOutput, OUTPUT_LINE_CAP, describeOutputSpan } from '@/utils/instanceOutput';

import { TagType, UiButton, UiCard, UiNotice, UiTag } from '@/components/ui';

import MfInstanceOutputText from './OutputText.vue';

/** Browsers report fractional scroll positions, so the bottom is a band rather than a pixel. */
const BOTTOM_SLACK_PX = 8;

const props = defineProps({
  output: {
    type: Object as PropType<IInstanceOutput>,
    required: true,
  },
  connected: {
    type: Boolean,
    default: false,
  },
  waiting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  reconnect: [];
}>();

const pane = useTemplateRef<HTMLElement>('pane');

const following = ref(true);

const missed = ref(0);

const span = computed(() => describeOutputSpan(props.output));

const status = computed<{ type: TagType; label: string }>(() => {
  if (props.output.ended === InstanceOutputEndReason.EXITED) {
    return { type: 'default', label: 'Ended' };
  }

  if (props.output.ended === InstanceOutputEndReason.LOST) {
    return { type: 'warning', label: 'Lost' };
  }

  if (props.connected) {
    return { type: 'success', label: 'Live' };
  }

  if (props.waiting) {
    return { type: 'default', label: 'Waiting' };
  }

  return props.output.tailLines === null
    ? { type: 'default', label: 'Connecting' }
    : { type: 'warning', label: 'Reconnecting' };
});

const scrollToBottom = () => {
  if (pane.value) {
    pane.value.scrollTop = pane.value.scrollHeight;
  }
};

const onScroll = () => {
  if (pane.value) {
    following.value = pane.value.scrollHeight - pane.value.scrollTop - pane.value.clientHeight <= BOTTOM_SLACK_PX;
  }

  if (following.value) {
    missed.value = 0;
  }
};

const follow = () => {
  following.value = true;
  missed.value = 0;

  scrollToBottom();
};

/** `lines` holds at the cap, so the lines it dropped count as received too. */
const received = (output: IInstanceOutput) => output.lines.length + output.dropped;

watch(
  () => props.output,
  (output, previous) => {
    if (following.value) {
      scrollToBottom();
    } else {
      missed.value += Math.max(0, received(output) - received(previous));
    }
  },
  { flush: 'post' }
);
</script>
