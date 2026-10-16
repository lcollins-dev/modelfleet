<template>
  <div class="inline-flex gap-0.5 rounded-lg border border-line bg-inset p-0.5" role="radiogroup">
    <button
      v-for="option of props.options"
      :key="option.value"
      type="button"
      role="radio"
      class="h-7 cursor-pointer whitespace-nowrap rounded-md px-2.5 text-xs outline-hidden transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
      :class="option.value === value ? 'bg-emphasis text-header' : 'bg-transparent text-muted'"
      :aria-checked="option.value === value"
      :disabled="props.disabled"
      @click="value = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="TValue extends string">
export interface ISegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

const value = defineModel<TValue>('value', { required: true });

const props = defineProps<{
  options: ISegmentedControlOption<TValue>[];
  disabled?: boolean;
}>();
</script>
