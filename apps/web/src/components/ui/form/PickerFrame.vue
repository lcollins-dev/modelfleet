<template>
  <div class="overflow-hidden rounded-lg border border-line" role="group" :aria-label="props.label">
    <div v-if="props.loading" class="flex justify-center py-8"><ui-spinner /></div>

    <slot v-else-if="$slots.status" name="status" />

    <ui-empty v-else-if="props.empty.length > 0">{{ props.empty }}</ui-empty>

    <template v-else>
      <div v-if="$slots.head" class="flex items-center gap-3 border-b border-divider px-4 py-1.5 text-xs text-muted">
        <slot name="head" />
      </div>

      <div
        class="[&>*+*]:border-t [&>*+*]:border-divider"
        :class="{ 'max-h-72 overflow-y-auto': props.scroll }"
        data-testid="picker-rows"
      >
        <slot />
      </div>
    </template>

    <div v-if="$slots.footer" class="border-t border-divider px-4 py-2.5 text-xs leading-snug">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import UiEmpty from '../feedback/Empty.vue';
import UiSpinner from '../feedback/Spinner.vue';

const props = withDefaults(
  defineProps<{
    label: string;

    loading?: boolean;

    /** Shown in place of the rows while non-empty. */
    empty?: string;

    scroll?: boolean;
  }>(),
  { loading: false, empty: '', scroll: false }
);
</script>
