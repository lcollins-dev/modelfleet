<template>
  <input-box :class="$attrs.class" :disabled="props.disabled" @mousedown="focusInput">
    <input
      ref="input"
      v-bind="inputAttrs"
      :value="text"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      role="spinbutton"
      :aria-valuemin="props.min"
      :aria-valuemax="props.max"
      :aria-valuenow="value ?? undefined"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :readonly="props.readonly"
      class="min-w-0 flex-1 self-stretch bg-transparent caret-primary outline-hidden placeholder:text-muted disabled:cursor-not-allowed"
      @input="onInput"
      @blur="settle"
      @keydown="onKeydown"
    />

    <span v-if="editable" class="-mr-1 ml-1 flex items-center gap-0.5 text-muted">
      <button
        v-if="showClear"
        type="button"
        :class="STEP_BUTTON_CLASS"
        class="hidden group-focus-within:flex group-hover:flex"
        aria-label="Clear"
        tabindex="-1"
        @mousedown.prevent
        @click="commit(null)"
      >
        <ui-disc-icon :icon="IconClose" :size="16" class="bg-muted text-surface opacity-70" />
      </button>

      <button
        type="button"
        :class="STEP_BUTTON_CLASS"
        aria-label="Decrease"
        tabindex="-1"
        :disabled="atMin"
        @mousedown.prevent
        @click="step(-1)"
      >
        <icon-remove class="size-4" />
      </button>

      <button
        type="button"
        :class="STEP_BUTTON_CLASS"
        aria-label="Increase"
        tabindex="-1"
        :disabled="atMax"
        @mousedown.prevent
        @click="step(1)"
      >
        <icon-add class="size-4" />
      </button>
    </span>
  </input-box>
</template>

<script setup lang="ts">
import { computed, ref, useAttrs, useTemplateRef, watch } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconClose from '~icons/material-symbols/close-rounded';
import IconRemove from '~icons/material-symbols/remove-rounded';

import UiDiscIcon from '../display/DiscIcon.vue';
import InputBox from './InputBox.vue';
import { inputAttrsOf } from './fieldInput';

const STEP_BUTTON_CLASS =
  'flex size-6 cursor-pointer items-center justify-center rounded-md bg-transparent text-muted outline-hidden transition-colors duration-150 hover:bg-emphasis hover:text-header disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

defineOptions({ inheritAttrs: false });

const value = defineModel<number | null>('value', { default: null });

const props = withDefaults(
  defineProps<{
    min?: number;
    max?: number;
    step?: number;
    /** Unset keeps the decimals as typed. */
    precision?: number;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    clearable?: boolean;
  }>(),
  {
    min: undefined,
    max: undefined,
    step: 1,
    precision: undefined,
    placeholder: undefined,
    disabled: false,
    readonly: false,
    clearable: false,
  }
);

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));

const inputElement = useTemplateRef('input');

const format = (next: number | null): string => {
  if (next === null) {
    return '';
  }

  return props.precision === undefined ? String(next) : next.toFixed(props.precision);
};

// Held apart from the value so a half-typed `1.` or `-` survives until it settles on blur.
const text = ref(format(value.value));

const editable = computed(() => !props.disabled && !props.readonly);

const showClear = computed(() => props.clearable && value.value !== null);

const atMin = computed(() => value.value !== null && props.min !== undefined && value.value <= props.min);

const atMax = computed(() => value.value !== null && props.max !== undefined && value.value >= props.max);

const parse = (raw: string): number | null | undefined => {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : undefined;
};

const inRange = (next: number): boolean =>
  (props.min === undefined || next >= props.min) && (props.max === undefined || next <= props.max);

const normalise = (next: number): number => {
  const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, next));

  return props.precision === undefined ? clamped : Number(clamped.toFixed(props.precision));
};

const commit = (next: number | null) => {
  const settled = next === null ? null : normalise(next);

  text.value = format(settled);

  if (settled !== value.value) {
    value.value = settled;
  }
};

const onInput = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }

  text.value = event.target.value;

  const parsed = parse(text.value);

  if (parsed === null || (parsed !== undefined && inRange(parsed) && normalise(parsed) === parsed)) {
    value.value = parsed;
  }
};

const settle = () => {
  const parsed = parse(text.value);

  commit(parsed === undefined ? value.value : parsed);
};

const step = (direction: 1 | -1) => {
  if (!editable.value) {
    return;
  }

  const current = parse(text.value) ?? value.value;

  commit(current === null ? (props.min ?? 0) : current + direction * props.step);
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    step(event.key === 'ArrowUp' ? 1 : -1);
  } else if (event.key === 'Enter') {
    settle();
  }
};

const focusInput = (event: MouseEvent) => {
  if (event.target !== inputElement.value) {
    event.preventDefault();
    inputElement.value?.focus();
  }
};

watch(value, next => {
  if (parse(text.value) !== next) {
    text.value = format(next);
  }
});
</script>
