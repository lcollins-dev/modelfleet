<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-divider px-6 py-3">
    <ui-input
      v-if="props.placeholder !== undefined"
      v-model:value="search"
      class="max-w-80 shrink grow basis-56"
      :placeholder="props.placeholder"
      :aria-label="props.placeholder"
      clearable
    />

    <slot name="start" />

    <div class="flex-1" />

    <ui-segmented-control
      v-if="props.segments !== undefined && filter !== undefined"
      v-model:value="filter"
      :options="props.segments"
    />

    <div v-else-if="props.options !== undefined" class="w-50 shrink-0">
      <ui-select :value="filter" :options="props.options" :aria-label="props.filterLabel" @update:value="pick" />
    </div>

    <slot />
  </div>
</template>

<script setup lang="ts" generic="TValue extends string">
import { ISegmentedControlOption, SelectOptions, UiInput, UiSegmentedControl, UiSelect } from '@/components/ui';

const search = defineModel<string>('search', { default: '' });

const filter = defineModel<TValue>('filter');

/** The search input shows only with a `placeholder`; `#start` adds controls before the spacer, the default slot after. */
const props = defineProps<{
  placeholder?: string;
  segments?: ISegmentedControlOption<TValue>[];
  options?: SelectOptions<TValue>;
  filterLabel?: string;
}>();

const pick = (value: TValue | null) => {
  if (value !== null) {
    filter.value = value;
  }
};
</script>
