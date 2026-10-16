<template>
  <span class="mr-1 inline-flex" :title="TELEMETRY_TITLES[telemetryStore.state]" data-testid="telemetry-tag">
    <ui-tag :type="TELEMETRY_TAG_TYPES[telemetryStore.state]">{{ label }}</ui-tag>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatFreshness } from '@/utils/format/date';

import { TelemetryState, useTelemetryStore } from '@/stores/telemetry';

import { TagType, UiTag } from '@/components/ui';

const TELEMETRY_TAG_TYPES: Record<TelemetryState, TagType> = {
  idle: 'default',
  live: 'success',
  stale: 'warning',
};

const TELEMETRY_TITLES: Record<TelemetryState, string> = {
  idle: 'This page holds no live stream open.',
  live: 'Every live stream on this page is current.',
  stale: 'A live stream on this page has disconnected or gone quiet.',
};

const telemetryStore = useTelemetryStore();

const label = computed(() => `Telemetry ${formatFreshness(telemetryStore.state, telemetryStore.ageSeconds)}`);
</script>
