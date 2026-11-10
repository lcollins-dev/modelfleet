<template>
  <ui-page-container wide>
    <ui-page-heading />

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
            <ui-button @click="goBack()">Cancel</ui-button>

            <ui-button type="primary" :loading="saving" @click="doSavePreset">Save Changes</ui-button>
          </div>
        </template>
      </mf-preset-form>

      <mf-danger-card
        label="Delete preset"
        help="Its configuration is removed for good. Deployments using it must move off first."
        action-label="Delete Preset"
        :loading="deleting"
        @action="confirmDelete"
      />
    </template>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watchEffect } from 'vue';
import { useRoute } from 'vue-router';

import { BackendId, backendField, declarationFor } from '@libs/backends';
import type { PresetDto, PresetChangedFieldDto, PresetImpactResponseDto, UpdatePresetRequestDto } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { ConfigurationFormValues, readFieldValues, writeFieldValues } from '@/utils/configuration/fields';
import { formatCount } from '@/utils/format/number';
import { DocumentEdits, applyToDocument } from '@/utils/yaml';

import { useLogService } from '@/services/LogService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useToastStore } from '@/stores/toast';

import { MfDangerCard, MfPresetForm } from '@/components/mf';
import { UiButton, UiCard, UiEmpty, UiPageContainer, UiPageHeading, UiSpinner } from '@/components/ui';

import { useGoBack } from '@/composables/useGoBack';
import { usePage } from '@/composables/usePage';

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
const { goBack } = useGoBack();
const dialogStore = useDialogStore();
const toastStore = useToastStore();
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

usePage({
  title: () => preset.value?.name ?? 'Preset',
  subtitle: 'Reusable settings for deployments.',
  back: '/presets',
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
      toastStore.addToast('Preset saved', 'Restart affected instances to use the new settings.');

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
          `This change affects ${describeDeployments(impact.affectedDeployments)}. Restart their running instances to use the new settings.`
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
        : 'The preset and its settings will be deleted.',
    confirmLabel: 'Delete Preset',
    action: () => doDeletePreset(target),
  });
};

const doDeletePreset = (target: PresetDto): Promise<void> => {
  deleting.value = true;

  return presetAdminService
    .deletePreset(target.id)
    .then(() => {
      toastStore.addToast('Preset deleted');

      goBack({ replace: true });
    })
    .finally(() => {
      deleting.value = false;
    });
};

watchEffect(() => {
  doGetPreset();
});
</script>
