<template>
  <button
    type="button"
    role="switch"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full align-middle outline-hidden transition duration-300 focus-visible:ring-2 focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-40"
    :class="value ? 'bg-primary' : 'bg-switch-rail'"
    :aria-checked="value"
    :aria-busy="props.loading || undefined"
    :disabled="props.disabled"
    @click="toggle"
  >
    <span
      class="absolute left-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-300"
      :class="{ 'translate-x-4': value }"
    >
      <ui-spinner v-if="props.loading" :size="12" aria-hidden="true" />
    </span>
  </button>
</template>

<script setup lang="ts">
import UiSpinner from '../feedback/Spinner.vue';

const value = defineModel<boolean>('value', { required: true });

const props = defineProps({
  disabled: {
    type: Boolean,
    default: false,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const toggle = () => {
  if (!props.loading) {
    value.value = !value.value;
  }
};
</script>
