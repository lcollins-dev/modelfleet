<template>
  <label
    class="group flex cursor-pointer items-center"
    :class="[{ 'cursor-not-allowed opacity-50': props.disabled }, $attrs.class]"
  >
    <span class="relative flex h-5 w-4 shrink-0 items-center">
      <input
        type="radio"
        class="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        :name="props.name"
        :value="props.value"
        :checked="checked"
        :disabled="props.disabled"
        v-bind="inputAttrs"
        @change="selected = props.value"
      />

      <span
        class="flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 group-hover:border-primary peer-focus-visible:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft"
        :class="checked ? 'border-primary' : 'border-line'"
        aria-hidden="true"
      >
        <span v-if="checked" class="size-2 rounded-full bg-primary" />
      </span>
    </span>

    <span v-if="$slots.default" class="min-w-0 px-2"><slot /></span>
  </label>
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import { inputAttrsOf } from './fieldInput';

defineOptions({ inheritAttrs: false });

/** Shared by every radio in the group, which `name` ties together for the keyboard. */
const selected = defineModel<string | null>('selected', { required: true });

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  value: {
    type: String,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));

const checked = computed(() => selected.value === props.value);
</script>
