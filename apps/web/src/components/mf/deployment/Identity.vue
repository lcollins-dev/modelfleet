<template>
  <ui-form @submit="emit('submit')">
    <ui-card title="Details">
      <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <ui-form-field
          v-slot="{ input }"
          path="name"
          label="Serving name"
          help="What apps use to call it. Lowercase letters, numbers and dashes."
        >
          <ui-input v-bind="input" v-model:value="name" class="font-mono" placeholder="llama-70b-chat" />
        </ui-form-field>

        <ui-form-field v-slot="{ input }" path="presetId" label="Preset" help="Settings below start from the preset.">
          <ui-select
            v-bind="input"
            :value="presetId === null ? null : String(presetId)"
            :options="presetOptions"
            :loading="loadingPresets"
            placeholder="No preset"
            searchable
            clearable
            @update:value="setPreset"
          />
        </ui-form-field>

        <ui-form-field v-slot="{ input }" path="backend" label="Backend" :help="backendHelp">
          <ui-input v-if="presetId !== null" v-bind="input" :value="backend ?? ''" class="font-mono" disabled />

          <ui-select v-else v-bind="input" v-model:value="backend" :options="backendOptions" placeholder="Pick one" />
        </ui-form-field>

        <ui-form-field v-slot="{ input }" path="modelId" label="Model" help="Weights held by at least one node.">
          <mf-model-select
            v-bind="input"
            v-model="modelId"
            :model-type="ModelType.MODEL"
            :formats="formats"
            value-key="id"
            placeholder="Search the catalogue"
            :fallback-label="props.modelName"
          />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          path="description"
          label="Description"
          help="Optional. What it is for, shown in the deployment list."
          class="sm:col-span-2"
        >
          <ui-textarea
            v-bind="input"
            v-model:value="description"
            :rows="2"
            placeholder="Large chat model for internal tools"
          />
        </ui-form-field>
      </div>

      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
    </ui-card>
  </ui-form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { BackendId, declarationFor } from '@libs/backends';
import type { ListPresetDto } from '@libs/dto';
import { ModelType } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';

import MfModelSelect from '@/components/mf/model/Select.vue';
import { ISelectOption, UiCard, UiForm, UiFormField, UiInput, UiSelect, UiTextarea } from '@/components/ui';

const LIST_PAGE = 1;

const logService = useLogService();
const logger = logService.createLogger('components/mf/DeploymentIdentity');

const presetAdminService = usePresetAdminService();

const emit = defineEmits<{ submit: [] }>();

const name = defineModel<string>('name', { required: true });
const description = defineModel<string>('description', { required: true });
const modelId = defineModel<number | null>('modelId', { required: true });
const presetId = defineModel<number | null>('presetId', { required: true });

/** Seeded with the preset's backend where one is named. */
const backend = defineModel<BackendId | null>('backend', { required: true });

const props = withDefaults(
  defineProps<{
    /** Keeps the selected model in the picker before a search has fetched it. */
    modelName?: string;

    presetName?: string | null;
  }>(),
  { modelName: undefined, presetName: null }
);

const presets = ref<ListPresetDto[]>([]);

const backendOptions = computed<ISelectOption<BackendId>[]>(() =>
  Object.values(BackendId).map(id => ({ label: id, value: id }))
);

const formats = computed(() => (backend.value === null ? undefined : [...declarationFor(backend.value).formats]));

const backendHelp = computed(() => {
  if (presetId.value === null) {
    return 'Choose what runs the model. It decides which models you can pick.';
  }

  return props.presetName === null ? 'Set by the preset.' : `Set by ${props.presetName}.`;
});

const loadingPresets = ref(false);

const presetOptions = computed<ISelectOption<string>[]>(() =>
  presets.value.map(preset => ({ label: preset.name, description: preset.backend, value: String(preset.id) }))
);

const setPreset = (next: string | null) => {
  const picked = presets.value.find(preset => String(preset.id) === next);

  presetId.value = picked?.id ?? null;

  if (picked !== undefined) {
    backend.value = picked.backend;
  }
};

const doGetPresets = () => {
  loadingPresets.value = true;
  presetAdminService
    .getPresetList({}, LIST_PAGE)
    .then(presetListResponse => {
      presets.value = presetListResponse.presetList;
    })
    .finally(() => {
      loadingPresets.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetPresets(): Failed to list the presets a deployment can inherit from');
    });
};

onMounted(() => {
  doGetPresets();
});
</script>
