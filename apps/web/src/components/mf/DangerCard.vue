<template>
  <ui-card danger rows>
    <ui-form-field :label="props.label" :help="props.help" layout="row" align="end">
      <ui-button type="danger-outline" :loading="props.loading" :disabled="props.disabled" @click="emit('action')">
        {{ props.actionLabel }}
      </ui-button>
    </ui-form-field>

    <slot />
  </ui-card>
</template>

<script setup lang="ts">
// The default slot takes further `layout="row" align="end"` fields, each ruled off from the one above.
import { UiButton, UiCard, UiFormField } from '@/components/ui';

const props = defineProps({
  label: {
    type: String,
    required: true,
  },
  help: {
    type: String,
    required: true,
  },
  actionLabel: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  action: [];
}>();
</script>
