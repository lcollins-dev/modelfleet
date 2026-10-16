<template>
  <ui-page-container wide>
    <ui-page-heading
      title="New deployment"
      subtitle="Name it, pick a preset or a backend and a model, then change only what you need."
      back-to="/deployments"
      back-label="Deployments"
    />

    <mf-deployment-identity
      v-model:name="form.name"
      v-model:description="form.description"
      v-model:model-id="form.modelId"
      v-model:preset-id="form.presetId"
      v-model:backend="form.backend"
      :preset-name="presetName"
      @submit="doCreateDeployment"
    />

    <mf-configuration-editor
      v-model="form.document"
      v-model:activation-policy="form.activationPolicy"
      :backend="form.backend"
      :has-preset="form.presetId !== null"
      :model-id="form.modelId"
      :preset-id="form.presetId"
      :inherited="inherited"
      :preset-name="presetName"
      @submit="doCreateDeployment"
    >
      <template #footer>
        <div class="flex gap-2">
          <ui-button to="/deployments">Cancel</ui-button>

          <ui-button type="primary" :loading="saving" @click="doCreateDeployment">Create Deployment</ui-button>
        </div>
      </template>
    </mf-configuration-editor>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type { ConfigurationDocument, CreateDeploymentRequestDto } from '@libs/dto';
import { ActivationPolicy } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';
import { useNotificationStore } from '@/stores/notification';

import { MfConfigurationEditor, MfDeploymentIdentity } from '@/components/mf';
import { UiButton, UiPageContainer, UiPageHeading } from '@/components/ui';

interface ICreateDeploymentForm {
  name: string;
  description: string;
  modelId: number | null;
  presetId: number | null;
  backend: BackendId | null;
  activationPolicy: ActivationPolicy;
  document: string;
}

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/deployments/Create');

const router = useRouter();

const notificationStore = useNotificationStore();
const deploymentAdminService = useDeploymentAdminService();
const presetAdminService = usePresetAdminService();

const form = reactive<ICreateDeploymentForm>({
  name: '',
  description: '',
  modelId: null,
  presetId: null,
  backend: BackendId.LLAMA_CPP,
  activationPolicy: ActivationPolicy.ALWAYS,
  document: '',
});

const preset = ref<{ name: string; configuration: ConfigurationDocument } | null>(null);

const saving = ref(false);

const ownBackend = computed(() => (form.presetId === null ? form.backend : null));

const presetName = computed(() => (form.presetId === null ? null : (preset.value?.name ?? null)));

const inherited = computed<ConfigurationDocument>(() =>
  form.presetId === null ? {} : (preset.value?.configuration ?? {})
);

const doGetPreset = (presetId: number) => {
  presetAdminService
    .getPreset(presetId)
    .then(loaded => {
      preset.value = { name: loaded.name, configuration: loaded.configuration };
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetPreset(): Failed to read the preset this deployment inherits from');
    });
};

const createRequest = (): CreateDeploymentRequestDto => ({
  name: form.name,
  modelId: form.modelId ?? 0,
  presetId: form.presetId ?? undefined,
  backend: ownBackend.value ?? undefined,
  activationPolicy: form.activationPolicy,
  description: form.description,
  document: form.document,
});

const doCreateDeployment = () => {
  saving.value = true;
  deploymentAdminService
    .createDeployment(createRequest())
    .then(created => {
      notificationStore.addToast(
        'Deployment created',
        form.activationPolicy === ActivationPolicy.ALWAYS
          ? `The scheduler starts ${form.name} on its next pass.`
          : `The first request to ${form.name} starts it.`
      );

      router.push(`/deployments/${created.id}`).catch((error: unknown) => {
        logger.error({ error }, 'doCreateDeployment(): Failed to navigate to deployment');
      });
    })
    .finally(() => {
      saving.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCreateDeployment(): Failed to create deployment');
    });
};

watch(
  () => form.presetId,
  presetId => {
    preset.value = null;

    if (presetId !== null) {
      doGetPreset(presetId);
    }
  }
);
</script>
