<template>
  <ui-page-container wide>
    <ui-page-heading
      title="New preset"
      subtitle="Settings any deployment can start from."
      back-to="/presets"
      back-label="Presets"
    />

    <mf-preset-form
      v-model:name="form.name"
      v-model:description="form.description"
      v-model:backend="form.backend"
      v-model:replicas="form.replicas"
      v-model:values="form.values"
      @submit="doCreatePreset"
    >
      <template #footer>
        <div class="flex gap-2">
          <ui-button to="/presets">Cancel</ui-button>

          <ui-button type="primary" :loading="saving" @click="doCreatePreset">Create Preset</ui-button>
        </div>
      </template>
    </mf-preset-form>
  </ui-page-container>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { BackendId, declarationFor } from '@libs/backends';
import type { CreatePresetRequestDto } from '@libs/dto';

import { ConfigurationFormValues, writeFieldValues } from '@/utils/configuration/fields';
import { DocumentEdits, applyToDocument } from '@/utils/yaml';

import { useLogService } from '@/services/LogService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';
import { useNotificationStore } from '@/stores/notification';

import { MfPresetForm } from '@/components/mf';
import { UiButton, UiPageContainer, UiPageHeading } from '@/components/ui';

interface ICreatePresetForm {
  name: string;
  description: string;
  backend: BackendId | null;
  replicas: number | null;
  values: ConfigurationFormValues;
}

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/presets/Create');

const router = useRouter();

const notificationStore = useNotificationStore();
const presetAdminService = usePresetAdminService();

const form = reactive<ICreatePresetForm>({
  name: '',
  description: '',
  backend: BackendId.LLAMA_CPP,
  replicas: null,
  values: {},
});

const saving = ref(false);

const buildDocument = (backend: BackendId): string => {
  const edits: DocumentEdits = {
    replicas: form.replicas ?? undefined,
    ...writeFieldValues(declarationFor(backend).fields, form.values),
  };

  return applyToDocument('', edits);
};

const doCreatePreset = () => {
  if (form.backend === null) {
    return;
  }

  const createPresetRequest: CreatePresetRequestDto = {
    name: form.name,
    description: form.description,
    backend: form.backend,
    document: buildDocument(form.backend),
  };

  saving.value = true;
  presetAdminService
    .createPreset(createPresetRequest)
    .then(created => {
      notificationStore.addToast('Preset created', 'You can pick it for any deployment.');

      router.push(`/presets/${created.id}`).catch((error: unknown) => {
        logger.error({ error }, 'doCreatePreset(): Failed to navigate to preset');
      });
    })
    .finally(() => {
      saving.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCreatePreset(): Failed to create preset');
    });
};
</script>
