<template>
  <ui-table-row :to="props.to" data-testid="model-row">
    <div class="min-w-0">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate font-mono font-medium text-header">{{ modelLabel(props.model) }}</span>

        <mf-licence-tag :licence="props.model.licence" />
      </div>

      <div class="mt-0.5 truncate text-xs text-muted">{{ description }}</div>
    </div>

    <div>
      <ui-tag :type="modelStateTone(props.model.state)">{{ formatModelState(props.model.state) }}</ui-tag>
    </div>

    <span class="font-mono text-xs" :title="nodeNames">{{ props.model.availability.length }}</span>

    <span class="font-mono text-xs">{{ formatBytes(props.model.sizeBytes) }}</span>

    <icon-chevron-right class="size-4 text-muted" />
  </ui-table-row>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { ListModelDto } from '@libs/dto';

import { formatBytes } from '@/utils/format/number';
import {
  companionLabel,
  formatModelKind,
  formatModelState,
  formatModelTasks,
  modelLabel,
  modelStateTone,
} from '@/utils/model';

import { UiTableRow, UiTag } from '@/components/ui';

import MfLicenceTag from './LicenceTag.vue';

const props = defineProps({
  model: {
    type: Object as PropType<ListModelDto>,
    required: true,
  },
  to: {
    type: String,
    default: undefined,
  },
});

const kindLabel = computed(() => companionLabel(props.model.type) ?? formatModelTasks(props.model.tasks));

const description = computed(() => `${kindLabel.value} · ${formatModelKind(props.model)}`);

const nodeNames = computed(() => props.model.availability.map(entry => entry.nodeName).join(', '));
</script>
