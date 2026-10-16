<template>
  <span
    class="flex size-4 shrink-0 items-center justify-center rounded-md border transition-colors duration-300 group-hover:border-primary peer-focus-visible:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary-soft"
    :class="
      props.checked || props.indeterminate
        ? 'border-primary bg-primary text-surface'
        : props.highlighted
          ? 'border-primary'
          : 'border-line'
    "
    aria-hidden="true"
  >
    <icon-remove v-if="props.indeterminate" class="size-4" />
    <icon-check v-else-if="props.checked" class="size-4" />
  </span>
</template>

<script setup lang="ts">
import IconCheck from '~icons/material-symbols/check-rounded';
import IconRemove from '~icons/material-symbols/remove-rounded';

const props = withDefaults(
  defineProps<{
    checked: boolean;
    indeterminate?: boolean;
    highlighted?: boolean;
  }>(),
  {
    indeterminate: false,
    highlighted: false,
  }
);
</script>
