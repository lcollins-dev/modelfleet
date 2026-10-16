<template>
  <div
    class="group relative flex min-h-8 w-full items-center rounded-lg border bg-inset text-sm transition duration-300"
    :class="[
      props.chevron ? 'gap-2 pl-2.5 pr-2' : 'px-2.5',
      props.disabled ? 'cursor-not-allowed text-muted' : 'cursor-text text-highlight',
      stateClass,
    ]"
  >
    <slot />

    <icon-expand-more
      v-if="props.chevron"
      class="size-4 shrink-0 text-muted transition-transform duration-300"
      :class="{ 'rotate-180': props.active }"
      aria-hidden="true"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';

const props = withDefaults(
  defineProps<{
    active?: boolean;
    disabled?: boolean;
    chevron?: boolean;
  }>(),
  {
    active: false,
    disabled: false,
    chevron: false,
  }
);

const stateClass = computed(() => {
  if (props.active) {
    return 'border-primary ring-3 ring-primary-soft';
  }

  if (props.disabled) {
    return 'border-line';
  }

  return 'border-line hover:border-line-strong focus-within:border-primary focus-within:ring-3 focus-within:ring-primary-soft focus-within:hover:border-primary';
});
</script>
