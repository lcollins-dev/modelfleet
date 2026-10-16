<template>
  <ui-form-field :label="field.label" :path="field.name" data-testid="configuration-field">
    <template #label>
      <span class="inline-flex flex-wrap items-center gap-2">
        {{ field.label }}

        <ui-tag v-if="overridden" type="primary">Overridden</ui-tag>
      </span>
    </template>

    <template #help>
      {{ field.description }}
      <span class="font-mono">{{ field.name }}</span>
    </template>

    <template #default="{ input }">
      <ui-select
        v-if="options !== null"
        v-bind="input"
        :value="selectedOption"
        :options="options"
        :placeholder="placeholder"
        clearable
        @update:value="setOption"
      />

      <mf-configuration-model-reference
        v-else-if="field.type === BackendFieldType.MODEL_REFERENCE"
        v-bind="input"
        :model-value="stringValue"
        :model-type="field.modelType"
        :placeholder="placeholder"
        :inherited="inheritedReference"
        @update:model-value="setValue"
      />

      <ui-number-input
        v-else-if="bounded !== null"
        v-bind="input"
        :value="numberValue"
        :placeholder="placeholder"
        :min="bounded.min"
        :max="bounded.max"
        :precision="bounded.precision"
        clearable
        @update:value="setValue"
      />

      <ui-textarea
        v-else-if="field.type === BackendFieldType.TEXT_LIST"
        v-bind="input"
        :value="listText ?? ''"
        :placeholder="listPlaceholder"
        :rows="4"
        code
        @update:value="setListText"
        @blur="tidyListInput"
      />

      <ui-input
        v-else-if="field.type === BackendFieldType.NUMBER_LIST"
        v-bind="input"
        :value="listText ?? ''"
        class="font-mono"
        :placeholder="listPlaceholder"
        :allow-input="allowsNumberListInput"
        clearable
        @update:value="setListText"
        @blur="tidyListInput"
      />

      <ui-input
        v-else
        v-bind="input"
        :value="stringValue ?? ''"
        :placeholder="placeholder"
        clearable
        @update:value="setText"
      />

      <div v-if="overridden" class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span class="min-w-0 truncate">
          Preset value
          <span class="font-mono text-normal">{{ describeConfigurationValue(inherited ?? null) }}</span>
        </span>

        <ui-button type="text" @click="value = null">
          <template #icon>
            <icon-settings-backup-restore class="size-4" />
          </template>
          Use preset value
        </ui-button>
      </div>
    </template>
  </ui-form-field>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import IconSettingsBackupRestore from '~icons/material-symbols/settings-backup-restore-rounded';

import { BackendField, BackendFieldType } from '@libs/backends';
import type { ConfigurationValue } from '@libs/dto';

import {
  ConfigurationFormValue,
  describeConfigurationValue,
  describeDefault,
  tidyListText,
} from '@/utils/configuration/fields';

import {
  ISelectOption,
  UiButton,
  UiFormField,
  UiInput,
  UiNumberInput,
  UiSelect,
  UiTag,
  UiTextarea,
} from '@/components/ui';

import MfConfigurationModelReference from './ModelReference.vue';

interface IBounds {
  min?: number;
  max?: number;
  precision?: number;
}

const BOOLEAN_ON = 'on';
const BOOLEAN_OFF = 'off';

const NUMBER_LIST_CHARACTERS = /[\d.,\s-]/g;

const BOOLEAN_OPTIONS: ISelectOption<string>[] = [
  { label: 'On', value: BOOLEAN_ON },
  { label: 'Off', value: BOOLEAN_OFF },
];

/** Vue casts an unbound prop whose type admits a boolean to false, so `inherited` needs its explicit default. */
const props = withDefaults(
  defineProps<{
    field: BackendField;

    /** Absent where no preset sets the key, which a null value does not mean. */
    inherited?: ConfigurationValue;

    defaultText?: string;
  }>(),
  { inherited: undefined, defaultText: undefined }
);

const value = defineModel<ConfigurationFormValue>({ required: true });

const stringValue = computed(() => (typeof value.value === 'string' ? value.value : null));
const numberValue = computed(() => (typeof value.value === 'number' ? value.value : null));
const selectedOption = computed(() => {
  if (typeof value.value === 'boolean') {
    return value.value ? BOOLEAN_ON : BOOLEAN_OFF;
  }

  return stringValue.value;
});

const inherits = computed(() => props.inherited !== undefined);

const overridden = computed(() => inherits.value && value.value !== null);

const placeholder = computed(() =>
  inherits.value && !overridden.value
    ? `Inherited: ${describeConfigurationValue(props.inherited ?? null)}`
    : `Default: ${props.defaultText ?? describeDefault(props.field)}`
);

const listPlaceholder = computed(() => {
  if (inherits.value && !overridden.value) {
    return placeholder.value;
  }

  return props.field.type === BackendFieldType.TEXT_LIST
    ? 'One entry per line'
    : 'Comma separated, one share per device';
});

const inheritedReference = computed(() => (typeof props.inherited === 'string' ? props.inherited : null));

const options = computed<ISelectOption<string>[] | null>(() => {
  if (props.field.type === BackendFieldType.BOOLEAN) {
    return BOOLEAN_OPTIONS;
  }

  if (props.field.type === BackendFieldType.CHOICE) {
    return props.field.choices.map(choice => ({ label: choice, value: choice }));
  }

  return null;
});

const bounded = computed<IBounds | null>(() => {
  if (props.field.type === BackendFieldType.INTEGER) {
    return { min: props.field.min, max: props.field.max, precision: 0 };
  }

  if (props.field.type === BackendFieldType.NUMBER) {
    return { min: props.field.min, max: props.field.max };
  }

  return null;
});

const setValue = (next: ConfigurationFormValue) => {
  value.value = next;
};

const setText = (next: string) => {
  value.value = next === '' ? null : next;
};

/** The model value comes back parsed, which would strip a trailing `.`, `,` or newline from what is being typed. */
const listText = ref<string | null>(stringValue.value);

watch(stringValue, next => {
  if (tidyListText(props.field, next) !== tidyListText(props.field, listText.value)) {
    listText.value = next;
  }
});

/** Compares with the current text, so an entry such as `auto` or `1e-7` from the YAML can still be edited away. */
const allowsNumberListInput = (text: string): boolean => strayCharacters(text) <= strayCharacters(listText.value ?? '');

const strayCharacters = (text: string): number => text.replace(NUMBER_LIST_CHARACTERS, '').length;

const setListText = (next: string) => {
  listText.value = next;
  value.value = next;
};

const tidyListInput = () => {
  listText.value = tidyListText(props.field, listText.value);
  value.value = listText.value;
};

const setOption = (next: string | null) => {
  if (props.field.type !== BackendFieldType.BOOLEAN) {
    value.value = next;

    return;
  }

  value.value = next === null ? null : next === BOOLEAN_ON;
};
</script>
