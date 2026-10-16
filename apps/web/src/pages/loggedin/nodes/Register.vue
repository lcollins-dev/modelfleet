<template>
  <ui-page-container>
    <ui-page-heading
      title="Register node"
      subtitle="Name the machine, then give its agent the credentials we show you."
      back-to="/nodes"
      back-label="Nodes"
    />

    <ui-form :name="FORM_NAME" layout="row" align="end" @submit="doRegisterNode">
      <ui-card title="Node details" rows>
        <ui-form-field v-slot="{ input }" label="Name" help="Lowercase letters, numbers, dashes and dots." path="name">
          <div class="w-100 max-w-full">
            <ui-input
              v-model:value="name"
              v-bind="input"
              name="node-name"
              autocomplete="off"
              placeholder="node-a-06"
              :disabled="loading"
            />
          </div>
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          label="Description"
          help="Optional. Where it is, or what it is for."
          path="description"
        >
          <div class="w-100 max-w-full">
            <ui-input
              v-model:value="description"
              v-bind="input"
              name="node-description"
              autocomplete="off"
              placeholder="Rack 4, DC1"
              :disabled="loading"
            />
          </div>
        </ui-form-field>

        <template #footer>
          <div class="flex gap-2">
            <ui-button :disabled="loading" to="/nodes">Cancel</ui-button>

            <ui-button type="primary" native-type="submit" :loading="loading">Register Node</ui-button>
          </div>
        </template>
      </ui-card>
    </ui-form>

    <ui-modal v-model:show="showCredentials" class="max-w-md" title="Node registered">
      <template #icon>
        <ui-disc-icon :icon="IconCheck" :size="20" class="bg-success text-surface" />
      </template>

      <template v-if="registered">
        <p class="mb-4 mt-0">
          <strong class="font-medium text-header">The secret is shown once.</strong>
          Copy it now. If you lose it, delete the node and register it again.
        </p>

        <ui-copy-values>
          <ui-copy-value label="Key" :value="registered.nodeKey" value-test-id="node-key" />
          <ui-copy-value label="Secret" :value="registered.secret" value-test-id="node-secret" />
        </ui-copy-values>

        <p class="mb-2 mt-4">Add these to the agent's environment, beside its <ui-code>SERVER_URL</ui-code>:</p>

        <ui-code block>{{ agentEnvironment }}</ui-code>

        <p class="mb-0 mt-3 text-muted">Then restart the agent so it picks them up.</p>

        <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
          <span v-if="connected" class="flex items-center gap-2 text-xs text-success" data-testid="agent-state">
            <icon-check-circle class="size-4" />
            The agent has checked in.
          </span>

          <span v-else class="flex items-center gap-2 text-xs text-muted" data-testid="agent-state">
            <ui-spinner :size="14" type="current" />
            Waiting for the agent to check in...
          </span>

          <div class="flex gap-2">
            <ui-button @click="finish(`/nodes/${registered.id}`)">Open Node</ui-button>

            <ui-button type="primary" @click="showCredentials = false">Done</ui-button>
          </div>
        </div>
      </template>
    </ui-modal>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import IconCheckCircle from '~icons/material-symbols/check-circle-outline-rounded';
import IconCheck from '~icons/material-symbols/check-rounded';

import type { EventDto, RegisterNodeResponseDto } from '@libs/dto';
import { EventPartyType, NodeState } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { ISseSubscription } from '@/services/api/SseService';
import { useEventAdminService } from '@/services/api/admin/EventAdminService';
import { useNodeAdminService } from '@/services/api/admin/NodeAdminService';
import { useNotificationStore } from '@/stores/notification';

import {
  UiButton,
  UiCard,
  UiCode,
  UiCopyValue,
  UiCopyValues,
  UiDiscIcon,
  UiForm,
  UiFormField,
  UiInput,
  UiModal,
  UiPageContainer,
  UiPageHeading,
  UiSpinner,
} from '@/components/ui';

const FORM_NAME = 'register-node';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/nodes/Register');

const router = useRouter();

const nodeAdminService = useNodeAdminService();
const eventAdminService = useEventAdminService();
const notificationStore = useNotificationStore();

const name = ref('');
const description = ref('');
const loading = ref(false);

const registered = ref<RegisterNodeResponseDto | null>(null);
const showCredentials = ref(false);
const connected = ref(false);

const subscription = shallowRef<ISseSubscription | null>(null);

let leaving = false;

const agentEnvironment = computed(() =>
  registered.value === null ? '' : `NODE_KEY=${registered.value.nodeKey}\nNODE_SECRET=${registered.value.secret}`
);

const doCheckConnected = (nodeId: number) => {
  nodeAdminService
    .getNode(nodeId)
    .then(node => {
      connected.value = node.state !== NodeState.REGISTERED;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCheckConnected(): Failed to get the node');
    });
};

const watchForCheckIn = (nodeId: number) => {
  const onEvent = (event: EventDto) => {
    if (event.subjectType === EventPartyType.NODE && event.subjectId === `${nodeId}`) {
      doCheckConnected(nodeId);
    }
  };

  subscription.value = eventAdminService.streamEvents(onEvent, () => doCheckConnected(nodeId));
};

const doRegisterNode = () => {
  if (loading.value) {
    return;
  }

  loading.value = true;

  nodeAdminService
    .registerNode({ name: name.value.trim(), description: description.value.trim() }, FORM_NAME)
    .then(response => {
      registered.value = response;
      showCredentials.value = true;

      watchForCheckIn(response.id);
    })
    .finally(() => {
      loading.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doRegisterNode(): Failed to register node');
    });
};

/** Leaving discards the secret, which nothing stores. */
const finish = (path: string) => {
  const target = registered.value;

  if (target === null || leaving) {
    return;
  }

  leaving = true;

  notificationStore.addToast(
    'Node registered',
    connected.value ? `${target.name} is online.` : `${target.name} appears as online once its agent checks in.`
  );

  router.push(path).catch((error: unknown) => {
    logger.error({ error }, 'finish(): Failed to leave the registration');
  });
};

watch(showCredentials, shown => {
  if (!shown) {
    finish('/nodes');
  }
});

onBeforeUnmount(() => {
  subscription.value?.close();
});
</script>
