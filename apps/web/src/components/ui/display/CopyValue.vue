<template>
  <div class="flex items-center gap-3 py-1.5 pl-3 pr-1.5">
    <span v-if="props.label" class="w-14 shrink-0 text-xs font-medium uppercase tracking-wider text-muted">
      {{ props.label }}
    </span>
    <span
      ref="valueElement"
      class="min-w-0 flex-1 break-all font-mono text-xs text-highlight"
      :data-testid="props.valueTestId"
    >
      {{ props.value }}
    </span>
    <ui-copy-button
      :value="props.value"
      failure-content="Your browser blocked clipboard access. The value is selected for you to copy by hand."
      @failed="selectValue"
    />
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue';

import UiCopyButton from '../action/CopyButton.vue';

const valueElement = useTemplateRef('valueElement');

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: undefined,
  },
  valueTestId: {
    type: String,
    default: undefined,
  },
});

const selectValue = () => {
  if (valueElement.value !== null) {
    window.getSelection()?.selectAllChildren(valueElement.value);
  }
};
</script>
