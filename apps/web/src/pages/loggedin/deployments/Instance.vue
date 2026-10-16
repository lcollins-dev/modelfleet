<template>
  <ui-page-container wide>
    <ui-page-heading :back-to="`/deployments/${deploymentId}`" :back-label="instance?.deploymentName ?? 'Deployment'">
      <template #title>
        Instance <span class="font-mono">{{ formatInstanceKey(instanceKey) }}</span>
      </template>

      <ui-tag v-if="removed" data-testid="instance-state">Removed</ui-tag>

      <ui-tag v-else-if="instance" :type="instanceStateTone(instance.state)" data-testid="instance-state">
        {{ formatInstanceState(instance.state) }}
      </ui-tag>
    </ui-page-heading>

    <ui-card v-if="instance" title="Details" data-testid="instance-details">
      <ui-stat-grid>
        <ui-stat label="Deployment">
          <ui-link :to="`/deployments/${instance.deploymentId}`" data-testid="instance-deployment-link">
            {{ instance.deploymentName }}
          </ui-link>
        </ui-stat>

        <ui-stat label="Node">
          <ui-link :to="`/nodes/${instance.nodeId}`" class="font-mono" data-testid="instance-node-link">
            {{ instance.nodeName }}
          </ui-link>
        </ui-stat>

        <ui-stat label="Devices">{{ formatDevices(instance.devices) }}</ui-stat>

        <ui-stat label="Uptime" data-testid="instance-uptime">{{ uptime ?? '-' }}</ui-stat>

        <ui-stat label="Last reported" data-testid="instance-reported">
          {{ instance.reportedDate === null ? 'Never' : formatRelativeDate(instance.reportedDate) }}
        </ui-stat>

        <ui-stat label="Created" mono>{{ formatDateTime(instance.createdDate) }}</ui-stat>

        <ui-stat v-if="instance.state === InstanceState.FAILED" label="Exit code" mono data-testid="instance-exit-code">
          {{ instance.exitCode ?? '-' }}
        </ui-stat>
      </ui-stat-grid>
    </ui-card>

    <ui-card
      v-if="failure"
      :title="failure.title"
      subtitle="The last output the node kept from the failed backend, not its full log."
      data-testid="output-failure"
    >
      <ui-code block tone="error"><mf-instance-output-text :segments="failure.segments" /></ui-code>
    </ui-card>

    <ui-notice v-else-if="refusal" type="error" title="The output could not be read" data-testid="output-refusal">
      {{ refusal }}

      <template #action>
        <ui-button @click="open">Try Again</ui-button>
      </template>
    </ui-notice>

    <mf-instance-output
      v-else
      class="h-[min(40rem,80dvh)] min-h-80"
      :output="output"
      :connected="connected"
      :waiting="waiting"
      @reconnect="open"
    />
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue';
import { useRoute } from 'vue-router';

import type { DeploymentInstancesResponseDto, ListInstanceDto } from '@libs/dto';
import { InstanceState } from '@libs/dto';

import { IAnsiSegment, PLAIN_STYLE, parseAnsi, plainText } from '@/utils/ansi';
import { formatDateTime, formatRelativeDate } from '@/utils/format/date';
import {
  formatDevices,
  formatInstanceFailure,
  formatInstanceKey,
  formatInstanceState,
  formatUptime,
  instanceStateTone,
} from '@/utils/instance';

import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';

import { MfInstanceOutput, MfInstanceOutputText } from '@/components/mf';
import {
  UiButton,
  UiCard,
  UiCode,
  UiLink,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiStat,
  UiStatGrid,
  UiTag,
} from '@/components/ui';

import { useInstanceOutput } from '@/composables/useInstanceOutput';

const NO_KEPT_OUTPUT: IAnsiSegment[] = [{ text: 'The node reported no output from this backend.', style: PLAIN_STYLE }];

const route = useRoute();
const instanceAdminService = useInstanceAdminService();

const deploymentId = computed(() =>
  typeof route.params.deploymentId === 'string' ? parseInt(route.params.deploymentId, 10) : null
);
const instanceKey = computed(() => (typeof route.params.instanceKey === 'string' ? route.params.instanceKey : ''));

const instance = shallowRef<ListInstanceDto | null>(null);
const removed = ref(false);

const { output, connected, refusal, waiting, open } = useInstanceOutput({
  instance: () =>
    deploymentId.value === null || instanceKey.value === ''
      ? null
      : { deploymentId: deploymentId.value, instanceKey: instanceKey.value },
  starting: () => !removed.value && instance.value?.state === InstanceState.STARTING,
  stream: instanceAdminService.streamInstanceOutput,
});

const uptime = computed(() => (instance.value === null ? null : formatUptime(instance.value.startedDate)));

// A failed launch may leave no container to stream, so its refusal falls back to the tail the node kept.
const failure = computed(() => {
  const failed = instance.value;
  const title = failed === null ? null : formatInstanceFailure(failed);

  if (refusal.value === null || failed === null || title === null) {
    return null;
  }

  const kept = parseAnsi(failed.message ?? '').segments;

  return { title, segments: plainText(kept).trim() === '' ? NO_KEPT_OUTPUT : kept };
});

const onInstances = (response: DeploymentInstancesResponseDto) => {
  const found = response.instances.find(candidate => candidate.instanceKey === instanceKey.value);

  if (found !== undefined) {
    instance.value = found;
  }

  removed.value = found === undefined && instance.value !== null;
};

watchEffect(onCleanup => {
  if (deploymentId.value === null) {
    return;
  }

  const subscription = instanceAdminService.streamDeploymentInstances(deploymentId.value, onInstances);

  onCleanup(() => subscription.close());
});
</script>
