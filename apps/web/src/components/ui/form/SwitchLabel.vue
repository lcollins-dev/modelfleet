<template>
  <label class="flex cursor-pointer items-center gap-2.5 text-highlight">
    <span v-if="props.labelFirst"><slot /></span>
    <ui-switch
      v-model:value="value"
      :aria-label="props.ariaLabel"
      :disabled="props.disabled"
      :loading="props.loading"
    />
    <span v-if="!props.labelFirst"><slot /></span>
  </label>
</template>

<script setup lang="ts">
import UiSwitch from './Switch.vue';

const value = defineModel<boolean>('value', { required: true });

const props = defineProps({
  ariaLabel: {
    type: String,
    default: undefined,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  labelFirst: {
    type: Boolean,
    default: false,
  },
});
</script>
