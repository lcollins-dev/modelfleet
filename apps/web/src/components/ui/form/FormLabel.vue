<template>
  <div>
    <label class="block text-sm font-medium text-normal" :for="props.for">
      <slot name="label">{{ props.label }}</slot>
    </label>
    <div v-if="props.help || $slots.help" :id="props.helpId" class="mt-0.5 text-xs leading-4 text-muted">
      <slot name="help">{{ props.help }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  help: {
    type: String,
    default: undefined,
  },
  for: {
    type: String,
    default: undefined,
  },
  helpId: {
    type: String,
    default: undefined,
  },
});
</script>
