<template>
  <input-box :class="$attrs.class" :disabled="props.disabled" @mousedown="focusInput">
    <span v-if="$slots.prefix" class="mr-2 flex shrink-0 items-center text-xs text-muted">
      <slot name="prefix" />
    </span>

    <input
      ref="input"
      v-bind="inputAttrs"
      :value="value"
      :type="inputType"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :readonly="props.readonly"
      class="min-w-0 flex-1 self-stretch bg-transparent caret-primary outline-hidden placeholder:text-muted [&::-ms-reveal]:hidden disabled:cursor-not-allowed"
      :class="{ 'text-muted': props.type === 'datetime-local' && value === '' }"
      @input="onInput"
    />

    <span v-if="showClear || isPassword || $slots.suffix" class="ml-1 flex items-center gap-1 text-muted">
      <button
        v-if="showClear"
        type="button"
        :class="ICON_BUTTON_CLASS"
        class="hidden group-focus-within:flex group-hover:flex"
        aria-label="Clear"
        @mousedown.prevent
        @click="value = ''"
      >
        <ui-disc-icon :icon="IconClose" :size="16" class="bg-muted text-surface opacity-70" />
      </button>

      <button
        v-if="isPassword"
        type="button"
        :class="ICON_BUTTON_CLASS"
        class="flex"
        :aria-label="revealed ? 'Hide password' : 'Show password'"
        :aria-pressed="revealed"
        :disabled="props.disabled"
        @mousedown.prevent
        @click="revealed = !revealed"
      >
        <icon-visibility v-if="revealed" class="size-4" />
        <icon-visibility-off v-else class="size-4" />
      </button>

      <slot name="suffix" />
    </span>
  </input-box>
</template>

<script setup lang="ts">
import { computed, PropType, ref, useAttrs, useTemplateRef } from 'vue';
import IconClose from '~icons/material-symbols/close-rounded';
import IconVisibilityOff from '~icons/material-symbols/visibility-off-outline-rounded';
import IconVisibility from '~icons/material-symbols/visibility-outline-rounded';

import UiDiscIcon from '../display/DiscIcon.vue';
import InputBox from './InputBox.vue';
import { inputAttrsOf } from './fieldInput';

type InputType = 'text' | 'email' | 'password' | 'datetime-local';

const ICON_BUTTON_CLASS =
  'cursor-pointer items-center justify-center bg-transparent text-muted outline-hidden disabled:cursor-not-allowed';

defineOptions({ inheritAttrs: false });

const value = defineModel<string>('value', { default: '' });

const props = defineProps({
  type: {
    type: String as PropType<InputType>,
    default: 'text',
  },
  placeholder: {
    type: String,
    default: undefined,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  clearable: {
    type: Boolean,
    default: false,
  },
  allowInput: {
    type: Function as PropType<(text: string) => boolean>,
    default: undefined,
  },
});

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));

const inputElement = useTemplateRef('input');

const revealed = ref(false);

const isPassword = computed(() => props.type === 'password');

const inputType = computed(() => (isPassword.value && revealed.value ? 'text' : props.type));

const showClear = computed(() => props.clearable && !props.disabled && !props.readonly && value.value !== '');

const onInput = (event: Event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }

  if (props.allowInput !== undefined && !props.allowInput(event.target.value)) {
    event.target.value = value.value;

    return;
  }

  value.value = event.target.value;
};

const focusInput = (event: MouseEvent) => {
  if (event.target !== inputElement.value) {
    event.preventDefault();
    inputElement.value?.focus();
  }
};
</script>
