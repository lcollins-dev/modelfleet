<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Edit settings"
      :subtitle="subtitle"
      :back-to="backTo"
      :back-label="deployment?.name ?? 'Deployment'"
    />

    <div v-if="loadingDeployment" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!deployment || !configuration">
      <ui-empty>Could not load this deployment.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="deployment.outOfDate" type="warning" title="Changes waiting to be applied">
        The instances stay out of date until you apply the changes from the deployment. Settings other than
        <ui-code>replicas</ui-code>, <ui-code>idleTimeout</ui-code> and <ui-code>vramGib</ui-code> need a relaunch.
      </ui-notice>

      <mf-deployment-identity
        v-model:name="form.name"
        v-model:description="form.description"
        v-model:model-id="form.modelId"
        v-model:preset-id="form.presetId"
        v-model:backend="form.backend"
        :preset-name="presetName"
        :model-name="deployment.modelName"
        @submit="doSave"
      />

      <mf-configuration-editor
        v-model="form.document"
        v-model:activation-policy="form.activationPolicy"
        :backend="form.backend"
        :has-preset="form.presetId !== null"
        :model-id="form.modelId"
        :preset-id="form.presetId"
        :deployment-id="deploymentId"
        :inherited="inherited"
        :preset-name="presetName"
        :effective="configuration"
        :placement-nodes="placementNodes"
        @submit="doSave"
      >
        <template #footer>
          <div class="flex gap-2">
            <ui-button :to="backTo">Cancel</ui-button>

            <ui-button type="primary" :loading="saving" @click="doSave">Save Changes</ui-button>
          </div>
        </template>
      </mf-configuration-editor>
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { BackendId, backendField, declarationFor } from '@libs/backends';
import type {
  ConfigurationDocument,
  DeploymentDto,
  DeploymentConfigurationDto,
  PlacementNodeDto,
  UpdateDeploymentRequestDto,
} from '@libs/dto';
import { ActivationPolicy } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { presetLayer } from '@/utils/deployment';

import { useLogService } from '@/services/LogService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import { MfConfigurationEditor, MfDeploymentIdentity } from '@/components/mf';
import {
  UiButton,
  UiCard,
  UiCode,
  UiEmpty,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiSpinner,
} from '@/components/ui';

interface IDeploymentForm {
  name: string;
  description: string;
  modelId: number | null;
  presetId: number | null;
  backend: BackendId | null;
  activationPolicy: ActivationPolicy;
  document: string;
}

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/deployments/Configuration');

const route = useRoute();
const router = useRouter();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const deploymentAdminService = useDeploymentAdminService();
const presetAdminService = usePresetAdminService();
const instanceAdminService = useInstanceAdminService();

const deploymentId = computed(() =>
  typeof route.params.deploymentId === 'string' ? parseInt(route.params.deploymentId, 10) : null
);

const deployment = ref<DeploymentDto | null>(null);
const configuration = ref<DeploymentConfigurationDto | null>(null);
const placementNodes = ref<PlacementNodeDto[]>([]);

const swappedInherited = ref<ConfigurationDocument | null>(null);
const swappedPresetName = ref<string | null>(null);

const form = reactive<IDeploymentForm>({
  name: '',
  description: '',
  modelId: null,
  presetId: null,
  backend: null,
  activationPolicy: ActivationPolicy.ALWAYS,
  document: '',
});

const loadingDeployment = ref(false);
const saving = ref(false);

const backTo = computed(() => `/deployments/${deploymentId.value ?? ''}`);

const swapped = computed(() => deployment.value !== null && form.presetId !== deployment.value.presetId);

const ownBackend = computed(() => (form.presetId === null ? form.backend : null));

const presetName = computed(() =>
  swapped.value ? swappedPresetName.value : (configuration.value?.presetName ?? null)
);

const subtitle = computed(() => {
  if (deployment.value === null) {
    return undefined;
  }

  return presetName.value === null
    ? `${deployment.value.name} · holds its own settings`
    : `${deployment.value.name} · starts from ${presetName.value}`;
});

const inherited = computed<ConfigurationDocument>(() => {
  if (swapped.value) {
    return swappedInherited.value ?? {};
  }

  return presetLayer(configuration.value?.entries ?? []);
});

const seedForm = (loaded: DeploymentDto) => {
  form.name = loaded.name;
  form.description = loaded.description ?? '';
  form.modelId = loaded.modelId;
  form.presetId = loaded.presetId;
  form.backend = loaded.backend;
  form.activationPolicy = loaded.activationPolicy;
  form.document = loaded.document;
};

const viewDeployment = () => {
  router.push(backTo.value).catch((error: unknown) => {
    logger.error({ error }, 'viewDeployment(): Failed to navigate to deployment');
  });
};

const doGetDeployment = () => {
  if (deploymentId.value === null) {
    return;
  }

  const requested = deploymentId.value;

  loadingDeployment.value = true;
  deploymentAdminService
    .getDeployment(requested)
    .then(deploymentResponse => {
      deployment.value = deploymentResponse;
      seedForm(deploymentResponse);
      doGetPlacementNodes(requested);

      return deploymentAdminService.getDeploymentConfiguration(requested);
    })
    .then(configurationResponse => {
      configuration.value = configurationResponse;
    })
    .finally(() => {
      loadingDeployment.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetDeployment(): Failed to get deployment');
    });
};

const doGetPlacementNodes = (requested: number) => {
  instanceAdminService
    .getDeploymentInstances(requested)
    .then(response => {
      placementNodes.value = response.placement.nodes;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetPlacementNodes(): Failed to read the nodes this deployment is placed on');
    });
};

const doGetSwappedPreset = (presetId: number) => {
  presetAdminService
    .getPreset(presetId)
    .then(preset => {
      swappedInherited.value = preset.configuration;
      swappedPresetName.value = preset.name;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetSwappedPreset(): Failed to read the preset being swapped in');
    });
};

const updateRequest = (): UpdateDeploymentRequestDto => ({
  name: form.name,
  modelId: form.modelId ?? 0,
  presetId: form.presetId,
  backend: ownBackend.value,
  activationPolicy: form.activationPolicy,
  description: form.description,
  document: form.document,
});

const doUpdate = (): Promise<void> => {
  if (deployment.value === null) {
    return Promise.resolve();
  }

  saving.value = true;

  return deploymentAdminService
    .updateDeployment(deployment.value.id, updateRequest())
    .then(() => {
      notificationStore.addToast('Settings saved', `${form.name} is saved.`);

      viewDeployment();
    })
    .finally(() => {
      saving.value = false;
    });
};

const describeDroppedKey = (target: BackendId, key: string): string =>
  backendField(declarationFor(target), key)?.label ?? key;

const confirmSwap = (droppedKeys: string[], target: BackendId, targetName: string | null) => {
  const declaration = configuration.value?.backend ?? target;

  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Move ${form.name} to another preset?`,
    message: () =>
      h('span', { class: 'flex flex-col gap-2' }, [
        h(
          'span',
          {},
          `${targetName ?? 'The deployment configuration'} uses ${target}, which does not support these overrides. Saving will remove them.`
        ),
        h(
          'ul',
          { class: 'm-0 list-disc pl-5' },
          droppedKeys.map(key => h('li', {}, describeDroppedKey(declaration, key)))
        ),
      ]),
    confirmLabel: 'Save Changes',
    action: doUpdate,
  });
};

const doSave = () => {
  const saved = deployment.value;

  if (saved === null) {
    return;
  }

  if (!swapped.value) {
    doUpdate().catch((error: unknown) => {
      logger.error({ error }, 'doSave(): Failed to save deployment');
    });

    return;
  }

  saving.value = true;
  deploymentAdminService
    .previewPresetSwap(saved.id, {
      presetId: form.presetId,
      backend: ownBackend.value,
      document: form.document,
    })
    .then(preview => {
      saving.value = false;

      if (preview.droppedKeys.length === 0) {
        return doUpdate();
      }

      confirmSwap(preview.droppedKeys, preview.backend, preview.presetName);
    })
    .catch((error: unknown) => {
      saving.value = false;
      logger.error({ error }, 'doSave(): Failed to save deployment');
    });
};

watchEffect(() => {
  doGetDeployment();
});

watchEffect(() => {
  if (form.presetId !== null && swapped.value) {
    doGetSwappedPreset(form.presetId);
  }
});
</script>
