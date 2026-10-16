<template>
  <ui-picker-frame :label="props.label" :loading="props.loading" :empty="props.empty" scroll>
    <template v-if="$slots.status" #status>
      <slot name="status" />
    </template>

    <template v-if="props.selectAll || $slots.summary" #head>
      <ui-checkbox
        v-if="props.selectAll"
        class="min-w-0 flex-1"
        :disabled="selectable.length === 0"
        :checked="allSelected"
        :indeterminate="someSelected"
        @update:checked="toggleAll"
      >
        Select all
      </ui-checkbox>

      <span v-else class="flex-1" />

      <span class="whitespace-nowrap" data-testid="picker-summary"><slot name="summary" /></span>
    </template>

    <ui-picker-row
      v-for="item of props.items"
      :key="item.value"
      :label="item.label"
      :checked="selected.includes(item.value)"
      :disabled="item.disabled"
      :mono="props.mono"
      @update:checked="checked => toggle(item.value, checked)"
    >
      <template #aside>
        <slot name="aside" :item="item">
          <span v-if="item.meta" class="whitespace-nowrap font-mono text-xs text-muted">{{ item.meta }}</span>
        </slot>
      </template>
    </ui-picker-row>
  </ui-picker-frame>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import UiCheckbox from './Checkbox.vue';
import UiPickerFrame from './PickerFrame.vue';
import UiPickerRow from './PickerRow.vue';

export interface IChecklistItem {
  value: string;
  label: string;
  meta?: string;
  disabled?: boolean;
}

const selected = defineModel<string[]>('selected', { default: () => [] });

const props = withDefaults(
  defineProps<{
    label: string;
    items: IChecklistItem[];

    selectAll?: boolean;
    mono?: boolean;

    loading?: boolean;
    empty?: string;
  }>(),
  { selectAll: false, mono: false, loading: false, empty: '' }
);

const selectable = computed(() => props.items.filter(item => item.disabled !== true).map(item => item.value));

const allSelected = computed(
  () => selectable.value.length > 0 && selectable.value.every(value => selected.value.includes(value))
);

const someSelected = computed(() => selected.value.length > 0 && !allSelected.value);

const toggle = (value: string, checked: boolean) => {
  selected.value = checked ? [...selected.value, value] : selected.value.filter(chosen => chosen !== value);
};

/** Leaves a disabled item as it stands, ticked or not. */
const toggleAll = (checked: boolean) => {
  const locked = selected.value.filter(value => !selectable.value.includes(value));

  selected.value = checked ? [...locked, ...selectable.value] : locked;
};
</script>
