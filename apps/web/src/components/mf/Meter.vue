<template>
  <div class="flex min-w-0 flex-col gap-1.5">
    <div
      v-if="props.label || props.detail"
      class="flex gap-3 whitespace-nowrap font-mono text-xs"
      :class="props.detail ? 'justify-between' : 'justify-end'"
    >
      <span class="truncate text-highlight">{{ props.label }}</span>

      <span v-if="props.detail" class="text-muted">{{ props.detail }}</span>
    </div>

    <div class="relative flex h-2 overflow-hidden rounded-sm bg-emphasis">
      <div
        v-for="(band, index) of props.bands"
        :key="`${index}-${band.label}`"
        :class="METER_TONE_CLASSES[band.tone]"
        :style="{ width: `${band.percent * scale}%` }"
        :title="band.value === undefined ? band.label : `${band.label} · ${band.value}`"
      />

      <div
        v-if="overflowing"
        data-overflow
        class="absolute inset-y-0 right-0 border-l-2"
        :class="METER_OVERFLOW_CLASS"
        :style="{ left: `${100 * scale}%` }"
        :title="`Over · ${props.overflowValue}`"
      />
    </div>

    <div v-if="props.legend" class="flex flex-wrap gap-x-4 gap-y-1" data-testid="meter-legend">
      <span
        v-for="(band, index) of props.bands"
        :key="`${index}-${band.label}`"
        class="flex min-w-0 items-center gap-1.5 text-xs text-muted"
      >
        <span class="size-2 shrink-0 rounded-xs" :class="METER_TONE_CLASSES[band.tone]" />

        <span class="truncate">{{ band.label }}</span>

        <span v-if="band.value" class="whitespace-nowrap font-mono text-highlight">{{ band.value }}</span>
      </span>

      <span v-if="overflowing" class="flex min-w-0 items-center gap-1.5 text-xs text-error">
        <span class="size-2 shrink-0 rounded-xs" :class="METER_OVERFLOW_CLASS" />

        <span class="truncate">Over</span>

        <span class="whitespace-nowrap font-mono">{{ props.overflowValue }}</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';

import { METER_OVERFLOW_CLASS, METER_TONE_CLASSES, MeterTone } from './meterTone';

/** `percent` is of the whole bar, so bands totalling under 100 leave the track showing. */
export interface IMeterBand {
  label: string;
  tone: MeterTone;
  percent: number;
  value?: string;
}

const props = defineProps({
  label: {
    type: String,
    default: undefined,
  },
  detail: {
    type: String,
    default: undefined,
  },
  bands: {
    type: Array as PropType<IMeterBand[]>,
    required: true,
  },
  legend: {
    type: Boolean,
    default: false,
  },

  /** Given, bands totalling over 100 narrow to fit and what runs past 100 is marked as over by this. */
  overflowValue: {
    type: String as PropType<string | null>,
    default: null,
  },
});

const totalPercent = computed(() => props.bands.reduce((sum, band) => sum + band.percent, 0));

const overflowing = computed(() => props.overflowValue !== null && totalPercent.value > 100);

const scale = computed(() => (overflowing.value ? 100 / totalPercent.value : 1));
</script>
