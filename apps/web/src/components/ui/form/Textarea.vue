<template>
  <div
    class="relative flex w-full flex-col rounded-lg border bg-inset transition duration-300"
    :class="[
      $attrs.class,
      props.disabled
        ? 'cursor-not-allowed border-line text-muted'
        : 'border-line text-highlight hover:border-line-strong focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft focus-within:hover:border-primary',
      { 'shadow-[inset_0_2px_4px_rgb(0_0_0/0.12)]': props.code },
    ]"
  >
    <textarea
      ref="textarea"
      v-bind="textareaAttrs"
      v-model="value"
      :rows="props.rows"
      :placeholder="props.placeholder"
      :disabled="props.disabled"
      :readonly="props.readonly"
      :maxlength="props.maxLength"
      :spellcheck="props.code ? false : undefined"
      class="box-border block min-h-13 w-full resize-none overflow-y-auto rounded-[inherit] border-0 bg-transparent px-2.5 caret-primary outline-hidden placeholder:text-muted disabled:cursor-not-allowed"
      :class="[
        props.code ? 'py-2 font-mono text-xs leading-relaxed' : 'py-1.5 text-sm leading-5',
        { 'pb-6': hasCount },
      ]"
    />

    <div
      v-if="hasCount"
      data-testid="textarea-count"
      class="pointer-events-none absolute bottom-[5px] right-5 text-xs leading-4 text-muted tabular-nums"
    >
      {{ value.length }}/{{ props.maxLength }}
    </div>

    <span
      v-if="!props.disabled"
      data-testid="textarea-grip"
      class="absolute bottom-px right-px size-3.5 cursor-ns-resize touch-none bg-[linear-gradient(135deg,transparent_46%,var(--color-muted)_46%,var(--color-muted)_56%,transparent_56%,transparent_74%,var(--color-muted)_74%,var(--color-muted)_84%,transparent_84%)] bg-size-[8px_8px] bg-position-[right_3px_bottom_3px] bg-no-repeat"
      aria-hidden="true"
      @pointerdown="startDrag"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, useAttrs, useTemplateRef } from 'vue';

import { inputAttrsOf } from './fieldInput';

const MIN_HEIGHT = 52;

defineOptions({ inheritAttrs: false });

const value = defineModel<string>('value', { default: '' });

const props = withDefaults(
  defineProps<{
    rows?: number;
    /** Also shows a live count of the characters used. */
    maxLength?: number;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    code?: boolean;
  }>(),
  {
    rows: 4,
    maxLength: undefined,
    placeholder: undefined,
    disabled: false,
    readonly: false,
    code: false,
  }
);

const attrs = useAttrs();

const textareaAttrs = computed(() => inputAttrsOf(attrs));

const hasCount = computed(() => props.maxLength !== undefined);

const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');

let stopDrag: (() => void) | undefined;

const startDrag = (event: PointerEvent) => {
  const element = textarea.value;

  if (element === null) {
    return;
  }

  event.preventDefault();

  const startY = event.clientY;
  const startHeight = element.offsetHeight;

  const move = (moveEvent: PointerEvent) => {
    element.style.height = `${Math.max(MIN_HEIGHT, startHeight + moveEvent.clientY - startY)}px`;
  };

  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    stopDrag = undefined;
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  stopDrag = stop;
};

onBeforeUnmount(() => stopDrag?.());
</script>
