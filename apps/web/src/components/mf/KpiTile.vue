<template>
  <ui-card>
    <div class="flex h-full flex-col">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium uppercase tracking-wider text-muted">{{ props.label }}</span>

        <component
          :is="props.icon"
          v-if="props.icon"
          class="size-4"
          :class="props.stale ? 'text-warning' : 'text-muted'"
        />
      </div>

      <div class="flex flex-auto flex-col justify-center">
        <div
          class="flex flex-wrap items-baseline gap-1.5"
          :class="shownBands.length > 0 ? 'mt-1.5' : 'mt-3.5'"
          data-testid="kpi-value"
        >
          <span class="text-2xl font-semibold tracking-tight text-header tabular-nums">{{ props.value }}</span>

          <span v-if="props.unit" class="text-xs text-muted">{{ props.unit }}</span>
        </div>

        <div
          v-if="shownBands.length > 0"
          class="mt-3 flex h-1 gap-0.5 overflow-hidden rounded-xs bg-emphasis"
          data-testid="kpi-bands"
        >
          <div
            v-for="(band, index) of shownBands"
            :key="index"
            class="basis-0 rounded-xs"
            :class="band.tone ? METER_TONE_CLASSES[band.tone] : undefined"
            :style="{ flexGrow: band.percent }"
          />
        </div>
      </div>

      <div
        v-if="shownLegend.length > 0"
        class="flex flex-wrap gap-x-3 gap-y-1"
        :class="shownBands.length > 0 ? 'mt-2.5' : 'mt-4.5'"
      >
        <span
          v-for="item of shownLegend"
          :key="item.label"
          class="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted"
        >
          <span
            v-if="legendDotted"
            class="size-1.5 shrink-0 rounded-full"
            :class="item.tone ? METER_TONE_CLASSES[item.tone] : 'bg-transparent'"
          />

          {{ item.label }}
        </span>
      </div>
    </div>
  </ui-card>
</template>

<script setup lang="ts">
import { type Component, PropType, computed } from 'vue';

import { UiCard } from '@/components/ui';

import { METER_TONE_CLASSES, MeterTone } from './meterTone';

export interface IKpiBand {
  /** Left empty without a tone, showing the track. */
  tone?: MeterTone;
  percent: number;
}

export interface IKpiLegendItem {
  label: string;
  tone?: MeterTone;
}

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  icon: {
    type: [Object, Function] as PropType<Component>,
    default: undefined,
  },
  value: {
    type: [String, Number],
    required: true,
  },
  unit: {
    type: String,
    default: undefined,
  },

  /** Each band takes its share of the bar relative to the others, so they need not total 100. */
  bands: {
    type: Array as PropType<IKpiBand[]>,
    default: () => [],
  },
  legend: {
    type: Array as PropType<IKpiLegendItem[]>,
    default: () => [],
  },

  /** Turns the icon warning and leads the legend with `Stale`. */
  stale: {
    type: Boolean,
    default: false,
  },
});

const shownBands = computed(() => props.bands.filter(band => band.percent > 0));

const shownLegend = computed<IKpiLegendItem[]>(() =>
  props.stale ? [{ label: 'Stale', tone: 'warning' }, ...props.legend] : props.legend
);

const legendDotted = computed(() => shownLegend.value.some(item => item.tone !== undefined));
</script>
