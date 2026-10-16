<template>
  <div
    class="flex items-center gap-3 py-1.5"
    :class="[
      props.nested ? 'pl-10' : 'pl-4',
      $slots.actions ? 'pr-2' : 'pr-4',
      { 'cursor-pointer': expanded !== undefined },
    ]"
    data-testid="picker-row"
    @click="toggleExpanded"
  >
    <ui-checkbox
      v-if="expanded === undefined"
      v-model:checked="checked"
      class="min-w-0 flex-1"
      :indeterminate="props.indeterminate"
      :disabled="props.disabled"
    >
      <span class="flex min-w-0 flex-col">
        <span class="text-highlight" :class="{ 'break-all font-mono': props.mono }">{{ props.label }}</span>

        <span v-if="$slots.description" class="text-xs text-muted"><slot name="description" /></span>
      </span>
    </ui-checkbox>

    <div v-else class="flex min-w-0 flex-1 items-center gap-2">
      <ui-checkbox
        v-model:checked="checked"
        :indeterminate="props.indeterminate"
        :disabled="props.disabled"
        :aria-label="props.label"
      />

      <span class="flex min-w-0 flex-col">
        <span class="text-highlight" :class="{ 'break-all font-mono': props.mono }">{{ props.label }}</span>

        <span v-if="$slots.description" class="text-xs text-muted"><slot name="description" /></span>
      </span>
    </div>

    <slot name="aside" />

    <slot name="actions" />
  </div>
</template>

<script setup lang="ts">
import UiCheckbox from './Checkbox.vue';

const checked = defineModel<boolean>('checked', { required: true });

/** Bound, the box alone ticks the row, and a click anywhere else but a button opens and closes it. */
const expanded = defineModel<boolean | undefined>('expanded', { default: undefined });

const props = withDefaults(
  defineProps<{
    label: string;

    indeterminate?: boolean;
    disabled?: boolean;

    mono?: boolean;
    nested?: boolean;
  }>(),
  { indeterminate: false, disabled: false, mono: false, nested: false }
);

const toggleExpanded = (event: MouseEvent) => {
  if (expanded.value === undefined) {
    return;
  }

  if (event.target instanceof Element && event.target.closest('input, button') !== null) {
    return;
  }

  expanded.value = !expanded.value;
};
</script>
