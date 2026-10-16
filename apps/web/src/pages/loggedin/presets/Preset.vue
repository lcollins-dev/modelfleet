<template>
  <ui-page-container wide>
    <ui-page-heading :title="preset?.name ?? 'Preset'" :subtitle="subtitle" back-to="/presets" back-label="Presets" />

    <div v-if="loadingPreset" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!preset">
      <ui-empty>Could not load this preset.</ui-empty>
    </ui-card>

    <template v-else>
      <mf-preset-form
        v-model:name="form.name"
        v-model:description="form.description"
        v-model:backend="form.backend"
        v-model:replicas="form.replicas"
        v-model:values="form.values"
        backend-locked
        @submit="doSavePreset"
      >
        <template #footer>
          <div class="flex gap-2">
            <ui-button to="/presets">Cancel</ui-button>

            <ui-button type="primary" :loading="saving" @click="doSavePreset">Save Changes</ui-button>
          </div>
        </template>
      </mf-preset-form>

      <mf-danger-card
        label="Delete preset"
        :help="deleteHelp"
        action-label="Delete Preset"
        :loading="deleting"
        @action="confirmDelete"
      />
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { BackendId, backendField, declarationFor } from '@libs/backends';
import type { PresetDto, PresetChangedFieldDto, PresetImpactResponseDto, UpdatePresetRequestDto } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { ConfigurationFormValues, readFieldValues, writeFieldValues } from '@/utils/configuration/fields';
import { formatCount } from '@/utils/format/number';
import { DocumentEdits, applyToDocument } from '@/utils/yaml';

import { useLogService } from '@/services/LogService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import { MfDangerCard, MfPresetForm } from '@/components/mf';
import { UiButton, UiCard, UiEmpty, UiPageContainer, UiPageHeading, UiSpinner } from '@/components/ui';

interface IPresetForm {
  name: string;
  description: string;
  backend: BackendId | null;
  replicas: number | null;
  values: ConfigurationFormValues;
}

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/presets/Preset');

const route = useRoute();
const router = useRouter();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const presetAdminService = usePresetAdminService();

const presetId = computed(() =>
  typeof route.params.presetId === 'string' ? parseInt(route.params.presetId, 10) : null
);

const preset = ref<PresetDto | null>(null);

const form = reactive<IPresetForm>({
  name: '',
  description: '',
  backend: null,
  replicas: null,
  values: {},
});

const loadingPreset = ref(false);
const saving = ref(false);
const deleting = ref(false);

/** `verb` is the plural form, and the singular is that plus an `s`. */
const describeDeployments = (count: number, verb?: string): string => {
  const subject = formatCount(count, 'deployment');

  return verb === undefined ? subject : `${subject} ${count === 1 ? `${verb}s` : verb}`;
};

const subtitle = computed(() => {
  if (preset.value === null) {
    return undefined;
  }

  return preset.value.deployments === 0
    ? 'No deployment uses it yet.'
    : `Used by ${describeDeployments(preset.value.deployments)}. They pick up changes the next time they are applied.`;
});

const deleteHelp = computed(() => {
  if (preset.value === null || preset.value.deployments === 0) {
    return 'Its configuration is removed. This cannot be undone.';
  }

  return `${describeDeployments(preset.value.deployments, 'use')} it. Move them to another preset or give them their own configuration first.`;
});

const fieldLabel = (backend: BackendId, key: string): string =>
  backendField(declarationFor(backend), key)?.label ?? key;

const buildDocument = (): string => {
  if (preset.value === null || form.backend === null) {
    return '';
  }

  const edits: DocumentEdits = {
    replicas: form.replicas ?? undefined,
    ...writeFieldValues(declarationFor(form.backend).fields, form.values),
  };

  return applyToDocument(preset.value.document, edits);
};

const seedForm = (loaded: PresetDto) => {
  const declaration = declarationFor(loaded.backend);
  const replicas = loaded.configuration.replicas;

  form.name = loaded.name;
  form.description = loaded.description ?? '';
  form.backend = loaded.backend;
  form.replicas = typeof replicas === 'number' ? replicas : null;
  form.values = readFieldValues(declaration.fields, loaded.configuration);
};

const viewPresetList = () => {
  router.push('/presets').catch((error: unknown) => {
    logger.error({ error }, 'viewPresetList(): Failed to navigate to preset list');
  });
};

const doGetPreset = () => {
  if (presetId.value === null) {
    return;
  }

  loadingPreset.value = true;
  presetAdminService
    .getPreset(presetId.value)
    .then(presetResponse => {
      preset.value = presetResponse;
      seedForm(presetResponse);
    })
    .finally(() => {
      loadingPreset.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetPreset(): Failed to get preset');
    });
};

const doUpdatePreset = (document: string): Promise<void> => {
  if (preset.value === null) {
    return Promise.resolve();
  }

  const updatePresetRequest: UpdatePresetRequestDto = {
    name: form.name,
    description: form.description,
    document,
  };

  saving.value = true;

  return presetAdminService
    .updatePreset(preset.value.id, updatePresetRequest)
    .then(() => {
      notificationStore.addToast('Preset saved', 'Deployments using it pick up the change when applied.');

      doGetPreset();
    })
    .finally(() => {
      saving.value = false;
    });
};

const describeChangedField = (backend: BackendId, changed: PresetChangedFieldDto): string =>
  `${fieldLabel(backend, changed.key)} - ${describeDeployments(changed.inheritingDeployments, 'inherit')} it`;

const confirmImpact = (backend: BackendId, document: string, impact: PresetImpactResponseDto) => {
  void dialogStore.confirm({
    type: DialogType.WARNING,
    title: `Save ${form.name}?`,
    message: () =>
      h('span', { class: 'flex flex-col gap-2' }, [
        h(
          'span',
          {},
          `This change affects ${describeDeployments(impact.affectedDeployments)} and marks their instances out of date.`
        ),
        h(
          'ul',
          { class: 'm-0 list-disc pl-5' },
          impact.changedFields.map(changed => h('li', {}, describeChangedField(backend, changed)))
        ),
      ]),
    confirmLabel: 'Save Preset',
    action: () => doUpdatePreset(document),
  });
};

const doSavePreset = () => {
  const saved = preset.value;

  if (saved === null) {
    return;
  }

  const document = buildDocument();

  saving.value = true;
  presetAdminService
    .getPresetImpact(saved.id, { document })
    .then(impact => {
      if (impact.affectedDeployments === 0) {
        return doUpdatePreset(document);
      }

      saving.value = false;
      confirmImpact(saved.backend, document, impact);
    })
    .catch((error: unknown) => {
      saving.value = false;
      logger.error({ error }, 'doSavePreset(): Failed to save preset');
    });
};

const confirmDelete = () => {
  const target = preset.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Delete ${target.name}?`,
    message:
      target.deployments > 0
        ? `${describeDeployments(target.deployments, 'use')} this preset. Move them to another preset or give them their own configuration before deleting it.`
        : 'Its configuration is removed.',
    confirmLabel: 'Delete Preset',
    action: () => doDeletePreset(target),
  });
};

const doDeletePreset = (target: PresetDto): Promise<void> => {
  deleting.value = true;

  return presetAdminService
    .deletePreset(target.id)
    .then(() => {
      notificationStore.addToast('Preset deleted', `${target.name} is removed.`);

      viewPresetList();
    })
    .finally(() => {
      deleting.value = false;
    });
};

watchEffect(() => {
  doGetPreset();
});
</script>
