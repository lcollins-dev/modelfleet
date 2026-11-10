<template>
  <ui-tag :type="TELEMETRY_TAG_TYPES[telemetryStore.state]" class="mr-1" data-testid="telemetry-tag">
    {{ label }}
  </ui-tag>
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

const telemetryStore = useTelemetryStore();

const label = computed(() => `Telemetry ${formatFreshness(telemetryStore.state, telemetryStore.ageSeconds)}`);
</script>
