<template>
  <ui-table :columns="COLUMNS" :min-width="560">
    <ui-table-head>
      <div>Setting</div>
      <div>Value</div>
      <div>Set by</div>
    </ui-table-head>

    <ui-table-row v-for="entry of entries" :key="entry.key" data-testid="effective-entry">
      <div class="min-w-0">
        <div class="truncate text-highlight">{{ label(entry) }}</div>
        <div class="truncate font-mono text-xs text-muted">{{ entry.key }}</div>
      </div>

      <div class="min-w-0 font-mono text-xs text-highlight">
        <span class="whitespace-pre-wrap break-all">{{ describeValue(entry) }}</span>
      </div>

      <div>
        <ui-tag :type="SOURCE_TAGS[entry.source].type">{{ SOURCE_TAGS[entry.source].label }}</ui-tag>
      </div>
    </ui-table-row>

    <template v-if="entries.length === 0" #empty>This deployment has no configuration.</template>
  </ui-table>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { backendField, declarationFor } from '@libs/backends';
import type { DeploymentConfigurationDto, EffectiveConfigurationEntryDto, PlacementNodeDto } from '@libs/dto';
import { ConfigurationSource } from '@libs/dto';

import { describeConfigurationValue } from '@/utils/configuration/fields';
import { describePlacement } from '@/utils/configuration/placement';

import { TagType, UiTable, UiTableHead, UiTableRow, UiTag } from '@/components/ui';

const COLUMNS = 'minmax(0,16rem) minmax(0,1fr) 7rem';

const PLACEMENT_KEY = 'placement';

interface ISourceTag {
  label: string;
  type: TagType;
}

const SOURCE_TAGS: Record<ConfigurationSource, ISourceTag> = {
  [ConfigurationSource.PRESET]: { label: 'Preset', type: 'default' },
  [ConfigurationSource.DEPLOYMENT]: { label: 'Deployment', type: 'primary' },
  [ConfigurationSource.DECLARATION]: { label: 'Modelfleet', type: 'default' },
};

/** No backend declaration models the fleet keys, so nothing else carries a label for them. */
const FLEET_LABELS: Record<string, string | undefined> = {
  replicas: 'Replicas',
  placement: 'Placement',
  idleTimeout: 'Idle timeout',
  vramGib: 'Declared VRAM (GiB)',
};

/** `placementNodes` names the nodes and devices a pinned placement holds; without them they read by id and key. */
const props = withDefaults(
  defineProps<{ configuration: DeploymentConfigurationDto; placementNodes?: PlacementNodeDto[] }>(),
  { placementNodes: () => [] }
);

const entries = computed(() => props.configuration.entries);

const describeValue = (entry: EffectiveConfigurationEntryDto): string =>
  entry.key === PLACEMENT_KEY
    ? describePlacement(entry.value, props.placementNodes)
    : describeConfigurationValue(entry.value);

const label = (entry: EffectiveConfigurationEntryDto): string =>
  backendField(declarationFor(props.configuration.backend), entry.key)?.label ?? FLEET_LABELS[entry.key] ?? entry.key;
</script>
