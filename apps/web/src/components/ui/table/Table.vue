<template>
  <div>
    <div
      v-if="$slots.toolbar"
      class="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-divider px-6 py-3"
      data-testid="table-toolbar"
    >
      <slot name="toolbar" />
    </div>

    <div
      class="overflow-x-auto"
      :class="{ [SCROLL_REGION_CLASS]: scrolls }"
      :role="scrolls ? 'region' : undefined"
      :tabindex="scrolls ? 0 : undefined"
      :aria-label="props.scrollLabel"
    >
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
import { computed } from 'vue';

import UiEmpty from '../feedback/Empty.vue';

const SCROLL_REGION_CLASS =
  'max-h-96 scroll-pt-9 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary';

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

  /** Given, the rows scroll inside a region of this name. Pair it with `sticky` on UiTableHead. */
  scrollLabel: {
    type: String,
    default: undefined,
  },
});

const scrolls = computed(() => props.scrollLabel !== undefined);
</script>
