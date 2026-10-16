<template>
  <ui-form @submit="emit('submit')">
    <ui-card title="Details">
      <div class="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        <ui-form-field
          v-slot="{ input }"
          path="name"
          label="Name"
          help="Shown when you pick a preset for a deployment."
        >
          <ui-input v-bind="input" v-model:value="name" placeholder="vLLM BF16 throughput" />
        </ui-form-field>

        <ui-form-field v-slot="{ input }" path="backend" label="Backend" :help="backendHelp">
          <ui-input v-if="props.backendLocked" v-bind="input" :value="backend ?? ''" class="font-mono" disabled />

          <ui-select v-else v-bind="input" v-model:value="backend" :options="backendOptions" placeholder="Pick one" />
        </ui-form-field>

        <ui-form-field
          v-slot="{ input }"
          path="description"
          label="Description"
          help="Optional. What the preset is tuned for."
          class="sm:col-span-2"
        >
          <ui-textarea
            v-bind="input"
            v-model:value="description"
            :rows="2"
            placeholder="Tuned for batch throughput on BF16 weights"
          />
        </ui-form-field>
      </div>

      <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
    </ui-card>
  </ui-form>

  <ui-card
    title="Settings"
    subtitle="Every deployment using this preset starts from these values."
    flush
    data-testid="preset-settings"
  >
    <mf-configuration-fields
      v-if="declaration !== null"
      v-model="values"
      :declaration="declaration"
      :lead="BACKEND_LEAD"
      @submit="emit('submit')"
    >
      <template #default="{ fields, values: fieldValues, setField, inherited: inheritedFor }">
        <mf-configuration-field
          v-if="fields[IMAGE_FIELD]"
          :field="fields[IMAGE_FIELD]"
          :inherited="inheritedFor(IMAGE_FIELD)"
          :default-text="imageDefault"
          :model-value="fieldValues[IMAGE_FIELD] ?? null"
          @update:model-value="setField(IMAGE_FIELD, $event)"
        />

        <ui-form-field
          v-slot="{ input }"
          path="replicas"
          label="Replicas"
          help="Set the instances kept on each selected node."
        >
          <ui-number-input
            v-bind="input"
            v-model:value="replicas"
            :min="1"
            :precision="0"
            placeholder="Default: 1"
            clearable
          />
        </ui-form-field>
      </template>
    </mf-configuration-fields>

    <ui-empty v-else>Choose a backend to configure its settings.</ui-empty>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </ui-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconInventory from '~icons/material-symbols/inventory-2-outline-rounded';

import { BackendId, declarationFor, definitionFor, IMAGE_FIELD } from '@libs/backends';

import { ConfigurationFormValues, describeImageDefault } from '@/utils/configuration/fields';

import {
  ISelectOption,
  UiCard,
  UiEmpty,
  UiForm,
  UiFormField,
  UiInput,
  UiNumberInput,
  UiSelect,
  UiTextarea,
} from '@/components/ui';

import MfConfigurationField from '../configuration/Field.vue';
import MfConfigurationFields, { IConfigurationLead } from '../configuration/Fields.vue';

const BACKEND_LEAD: IConfigurationLead = {
  label: 'Backend',
  icon: IconInventory,
  description: 'The image every instance runs, and how many instances run.',
  keys: [IMAGE_FIELD, 'replicas'],
  fields: [IMAGE_FIELD],
};

const emit = defineEmits<{ submit: [] }>();

const name = defineModel<string>('name', { required: true });
const description = defineModel<string>('description', { required: true });
const backend = defineModel<BackendId | null>('backend', { required: true });
const replicas = defineModel<number | null>('replicas', { required: true });
const values = defineModel<ConfigurationFormValues>('values', { required: true });

const props = defineProps({
  backendLocked: {
    type: Boolean,
    default: false,
  },
});

const backendOptions = computed<ISelectOption<BackendId>[]>(() =>
  Object.values(BackendId).map(id => ({ label: id, value: id }))
);

const backendHelp = computed(() =>
  props.backendLocked
    ? 'Set when the preset was created. Create a new preset for another backend.'
    : 'Choose the backend. You cannot change it later.'
);

const declaration = computed(() => (backend.value === null ? null : declarationFor(backend.value)));

const imageDefault = computed(() =>
  backend.value === null ? undefined : describeImageDefault(definitionFor(backend.value).images)
);
</script>
