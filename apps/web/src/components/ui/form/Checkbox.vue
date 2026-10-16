<template>
  <label
    class="group flex cursor-pointer items-center"
    :class="[{ 'cursor-not-allowed opacity-50': props.disabled }, $attrs.class]"
  >
    <span class="relative flex h-5 w-4 shrink-0 items-center">
      <input
        v-model="checked"
        type="checkbox"
        class="peer absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        :disabled="props.disabled"
        :indeterminate="props.indeterminate"
        :aria-checked="props.indeterminate ? 'mixed' : undefined"
        v-bind="inputAttrs"
      />

      <checkbox-box :checked="checked" :indeterminate="props.indeterminate" />
    </span>

    <span v-if="$slots.default" class="px-2"><slot /></span>
  </label>
</template>

<script setup lang="ts">
import { computed, useAttrs } from 'vue';

import CheckboxBox from './CheckboxBox.vue';
import { inputAttrsOf } from './fieldInput';

defineOptions({ inheritAttrs: false });

const checked = defineModel<boolean>('checked', { required: true });

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  /** Shows over `checked`; a tick still emits `update:checked`. */
  indeterminate: {
    type: Boolean,
    default: false,
  },
});

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));
</script>
