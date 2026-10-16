<template>
  <ui-page-container>
    <ui-page-heading
      title="New API key"
      subtitle="You see the secret once, right after you create the key."
      back-to="/api-keys"
      back-label="API keys"
    />

    <ui-form :name="FORM_NAME" @submit="doCreateApiKey">
      <ui-card>
        <ui-form-field v-slot="{ input }" label="Name" help="Helps you recognise the key in the list." path="name">
          <ui-input
            v-model:value="name"
            v-bind="input"
            name="api-key-name"
            autocomplete="off"
            placeholder="nightly-eval"
            :disabled="loading"
          />
        </ui-form-field>

        <template #footer>
          <div class="flex gap-2">
            <ui-button :disabled="loading" to="/api-keys">Cancel</ui-button>

            <ui-button type="primary" native-type="submit" :loading="loading">Create Key</ui-button>
          </div>
        </template>
      </ui-card>
    </ui-form>

    <ui-modal v-model:show="showToken" class="max-w-md" title="Copy your key now">
      <template #icon>
        <ui-disc-icon :icon="IconPriorityHigh" :size="20" class="bg-warning text-surface" />
      </template>

      <template v-if="created">
        <p class="mb-4 mt-0">
          This is the only time you will see the secret. If you lose it, revoke the key and create another.
        </p>

        <ui-copy-values>
          <ui-copy-value :value="created.token" value-test-id="api-key-token" />
        </ui-copy-values>

        <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <span>Reaches every deployment</span>
          <span>Never expires</span>
        </div>

        <div class="mt-5 flex justify-end">
          <ui-button type="primary" @click="showToken = false">Done</ui-button>
        </div>
      </template>
    </ui-modal>
  </ui-page-container>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import IconPriorityHigh from '~icons/material-symbols/priority-high-rounded';

import type { CreateApiKeyResponseDto } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { useApiKeyAdminService } from '@/services/api/admin/ApiKeyAdminService';
import { useNotificationStore } from '@/stores/notification';

import {
  UiButton,
  UiCard,
  UiCopyValue,
  UiCopyValues,
  UiDiscIcon,
  UiForm,
  UiFormField,
  UiInput,
  UiModal,
  UiPageContainer,
  UiPageHeading,
} from '@/components/ui';

const FORM_NAME = 'create-api-key';

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/api-keys/Create');

const router = useRouter();

const apiKeyAdminService = useApiKeyAdminService();
const notificationStore = useNotificationStore();

const name = ref('');
const loading = ref(false);

const created = ref<CreateApiKeyResponseDto | null>(null);
const showToken = ref(false);

const doCreateApiKey = () => {
  if (loading.value) {
    return;
  }

  loading.value = true;

  apiKeyAdminService
    .createApiKey({ name: name.value.trim() }, FORM_NAME)
    .then(response => {
      created.value = response;
      showToken.value = true;
    })
    .finally(() => {
      loading.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCreateApiKey(): Failed to create API key');
    });
};

/** Leaving discards the token, which nothing stores. */
watch(showToken, shown => {
  if (shown || created.value === null) {
    return;
  }

  notificationStore.addToast('Key created', `${created.value.apiKey.name} is ready to use.`);

  router.push('/api-keys').catch((error: unknown) => {
    logger.error({ error }, 'watch(showToken): Failed to return to the key list');
  });
});
</script>
