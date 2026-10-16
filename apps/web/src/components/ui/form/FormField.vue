<template>
  <div
    v-if="layout === 'row' && align === 'end'"
    data-testid="form-field"
    data-layout="row"
    data-align="end"
    class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 py-4"
  >
    <div class="shrink grow basis-72">
      <ui-form-label :label="props.label" :help="props.help" :for="ids.input" :help-id="ids.help">
        <template v-if="$slots.label" #label><slot name="label" /></template>
        <template v-if="$slots.help" #help><slot name="help" /></template>
      </ui-form-label>
    </div>

    <div class="flex max-w-full flex-col items-end text-right">
      <slot :input="input" />

      <ui-field-error v-if="error" :id="ids.error" class="mt-1" data-testid="field-error">{{ error }}</ui-field-error>
    </div>
  </div>

  <div
    v-else-if="layout === 'row'"
    data-testid="form-field"
    data-layout="row"
    data-align="start"
    class="flex flex-wrap items-start gap-x-6 gap-y-2 pb-1.5 pt-2.5"
  >
    <div class="flex min-h-8 min-w-44 shrink grow-0 basis-56 items-center">
      <ui-form-label :label="props.label" :help="props.help" :for="ids.input" :help-id="ids.help">
        <template v-if="$slots.label" #label><slot name="label" /></template>
        <template v-if="$slots.help" #help><slot name="help" /></template>
      </ui-form-label>
    </div>

    <div class="max-w-sm shrink grow basis-64">
      <slot :input="input" />

      <div class="mt-1 min-h-4">
        <ui-field-error v-if="error" :id="ids.error" data-testid="field-error">{{ error }}</ui-field-error>
      </div>
    </div>
  </div>

  <div v-else data-testid="form-field" data-layout="stacked" class="flex flex-col">
    <!-- Growing keeps controls level across grid columns whose help wraps to different heights. -->
    <ui-form-label
      class="grow"
      :class="hasHelp ? 'mb-2' : 'mb-1'"
      :label="props.label"
      :help="props.help"
      :for="ids.input"
      :help-id="ids.help"
    >
      <template v-if="$slots.label" #label><slot name="label" /></template>
      <template v-if="$slots.help" #help><slot name="help" /></template>
    </ui-form-label>

    <slot :input="input" />

    <div class="mb-1.5 mt-1 min-h-4">
      <ui-field-error v-if="error" :id="ids.error" data-testid="field-error">{{ error }}</ui-field-error>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, PropType, useId } from 'vue';

import UiFieldError from './FieldError.vue';
import UiFormLabel from './FormLabel.vue';
import { fieldIds, fieldInputProps, IFieldInputProps } from './fieldInput';
import { FORM_CONTEXT_KEY, FieldAlign, FieldLayout } from './formContext';
import { useFieldError } from './useFieldError';

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  help: {
    type: String,
    default: undefined,
  },
  path: {
    type: String,
    default: undefined,
  },
  error: {
    type: String,
    default: '',
  },
  layout: {
    type: String as PropType<FieldLayout>,
    default: undefined,
  },
  align: {
    type: String as PropType<FieldAlign>,
    default: undefined,
  },
});

const slots = defineSlots<{
  default(slotProps: { input: IFieldInputProps }): unknown;
  label?(): unknown;
  help?(): unknown;
}>();

const formContext = inject(FORM_CONTEXT_KEY, null);

const layout = computed(() => props.layout ?? formContext?.layout ?? 'stacked');
const align = computed(() => props.align ?? formContext?.align ?? 'start');

const ids = fieldIds(useId());

const error = useFieldError(props);

const hasHelp = computed(() => (props.help ?? '') !== '' || slots.help !== undefined);

const input = computed(() => fieldInputProps(ids, hasHelp.value, error.value !== ''));
</script>
