<template>
  <ui-page-container wide>
    <ui-page-heading>
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

        <ui-stat label="VRAM" data-testid="instance-vram">{{ vram }}</ui-stat>

        <ui-stat label="RAM" data-testid="instance-resident-memory">{{ residentMemory }}</ui-stat>

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
      title="Saved output"
      subtitle="Final lines captured from the failed backend."
      data-testid="output-failure"
    >
      <ui-code block tone="error"><mf-instance-output-text :segments="failure" /></ui-code>
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

import type { DeploymentInstancesResponseDto, ListInstanceDto, NodeTelemetryStatusDto } from '@libs/dto';
import { InstanceState } from '@libs/dto';

import { IAnsiSegment, PLAIN_STYLE, parseAnsi, plainText } from '@/utils/ansi';
import { formatDateTime, formatRelativeDate } from '@/utils/format/date';
import { formatBytes } from '@/utils/format/number';
import {
  formatDevices,
  formatResidentMemory,
  formatInstanceKey,
  formatInstanceState,
  formatUptime,
  instanceStateTone,
} from '@/utils/instance';

import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';

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
import { usePage } from '@/composables/usePage';

const NO_KEPT_OUTPUT: IAnsiSegment[] = [{ text: 'The node reported no output from this backend.', style: PLAIN_STYLE }];

const route = useRoute();
const instanceAdminService = useInstanceAdminService();
const telemetryAdminService = useTelemetryAdminService();

const deploymentId = computed(() =>
  typeof route.params.deploymentId === 'string' ? parseInt(route.params.deploymentId, 10) : null
);
const instanceKey = computed(() => (typeof route.params.instanceKey === 'string' ? route.params.instanceKey : ''));

usePage({
  title: () => `Instance ${formatInstanceKey(instanceKey.value)}`,
  back: () => `/deployments/${deploymentId.value ?? ''}`,
});

const instance = shallowRef<ListInstanceDto | null>(null);
const telemetryStatus = shallowRef<NodeTelemetryStatusDto | null>(null);
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

const nodeId = computed(() => instance.value?.nodeId ?? null);

const vram = computed(() => {
  const held = (telemetryStatus.value?.devices ?? [])
    .flatMap(device => device.processes)
    .filter(process => process.instanceKey === instanceKey.value);

  if (held.length === 0) {
    return '-';
  }

  return formatBytes(held.reduce((total, process) => total + (process.usedBytes ?? 0), 0));
});

const residentMemory = computed(() =>
  formatResidentMemory(
    telemetryStatus.value?.host?.instanceMemory.find(candidate => candidate.instanceKey === instanceKey.value)
      ?.residentBytes
  )
);

// A failed launch may leave no container to stream, so its refusal falls back to the tail the node kept.
const failure = computed(() => {
  const failed = instance.value;

  if (refusal.value === null || failed === null || failed.state !== InstanceState.FAILED) {
    return null;
  }

  const kept = parseAnsi(failed.message ?? '').segments;

  return plainText(kept).trim() === '' ? NO_KEPT_OUTPUT : kept;
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

watchEffect(onCleanup => {
  if (nodeId.value === null) {
    return;
  }

  const subscription = telemetryAdminService.streamNodeTelemetryStatus(nodeId.value, status => {
    telemetryStatus.value = status;
  });

  onCleanup(() => subscription.close());
});
</script>
