<template>
  <div>
    <div
      v-if="$slots.toolbar"
      class="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-divider px-6 py-3"
      data-testid="table-toolbar"
    >
      <slot name="toolbar" />
    </div>

    <div class="overflow-x-auto">
      <div :style="{ '--table-columns': props.columns, minWidth: `${props.minWidth}px` }">
        <slot />
      </div>
    </div>

    <ui-empty v-if="$slots.empty" class="border-t border-divider" data-testid="table-empty">
      <slot name="empty" />
    </ui-empty>

    <div
      v-if="$slots.footer"
      class="flex items-center justify-between gap-3 border-t border-divider px-6 py-2.5 text-xs text-muted"
      data-testid="table-footer"
    >
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import UiEmpty from '../feedback/Empty.vue';

/**
 * `columns` is a `grid-template-columns` value that UiTableHead and UiTableRow lay their cells out on. Pass `#empty`
 * only while there are no rows to show.
 */
const props = defineProps({
  columns: {
    type: String,
    required: true,
  },
  minWidth: {
    type: Number,
    default: 640,
  },
});
</script>
