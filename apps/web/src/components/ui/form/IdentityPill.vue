<template>
  <div class="flex items-center gap-2.5 rounded-full border border-divider bg-inset py-1 pl-3 pr-1">
    <icon-account-circle class="size-4 shrink-0 text-muted" aria-hidden="true" />

    <span class="min-w-0 flex-1 truncate text-highlight" data-testid="identity"><slot /></span>

    <ui-button type="text" :disabled="props.disabled" @click="emit('change')">{{ props.actionLabel }}</ui-button>
  </div>
</template>

<script setup lang="ts">
import IconAccountCircle from '~icons/material-symbols/account-circle-outline-rounded';

import UiButton from '../action/Button.vue';

const props = defineProps({
  actionLabel: {
    type: String,
    default: 'Change',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits<{
  change: [];
}>();
</script>
