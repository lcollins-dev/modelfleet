<template>
  <ui-table-row :to="props.to" data-testid="deployment-row">
    <div class="min-w-0">
      <div class="flex min-w-0 items-center gap-2">
        <span class="truncate font-mono font-medium text-header">{{ props.deployment.name }}</span>

        <mf-licence-tag :licence="props.deployment.modelLicence" />
      </div>

      <div class="mt-0.5 truncate text-xs text-muted">{{ description }}</div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <ui-tag v-if="disabledAtRest" type="error">Disabled</ui-tag>

      <template v-else>
        <ui-tag :type="deploymentRunTone(runState)">{{ formatDeploymentRunState(runState) }}</ui-tag>

        <ui-tag v-if="!props.deployment.enabled" type="error">Disabled</ui-tag>
      </template>

      <ui-tag v-if="props.deployment.outOfDate" type="warning">Out of date</ui-tag>
    </div>

    <span class="text-xs">{{ formatActivationPolicy(props.deployment.activationPolicy) }}</span>

    <span class="font-mono text-xs">{{ ownInstances.length }}</span>

    <icon-chevron-right class="size-4 text-muted" />
  </ui-table-row>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import type { ListDeploymentDto, ListInstanceDto } from '@libs/dto';

import {
  deploymentRunState,
  deploymentRunTone,
  formatActivationPolicy,
  formatDeploymentRunState,
} from '@/utils/deployment';

import { UiTableRow, UiTag } from '@/components/ui';

import MfLicenceTag from '../model/LicenceTag.vue';

const props = defineProps({
  deployment: {
    type: Object as PropType<ListDeploymentDto>,
    required: true,
  },

  /** Every instance in the fleet, not only this deployment's. */
  instances: {
    type: Array as PropType<ListInstanceDto[]>,
    required: true,
  },
  to: {
    type: String,
    default: undefined,
  },
});

const ownInstances = computed(() => props.instances.filter(instance => instance.deploymentId === props.deployment.id));

const runState = computed(() => deploymentRunState(props.deployment.id, props.instances));

const disabledAtRest = computed(() => !props.deployment.enabled && runState.value === 'idle');

const description = computed(() => {
  const preset = props.deployment.presetName ?? 'no preset';

  return `${props.deployment.modelName} · ${props.deployment.backend} · ${preset}`;
});
</script>
