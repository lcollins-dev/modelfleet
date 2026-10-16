<template>
  <div
    v-if="props.to !== undefined"
    :id="rowId"
    :class="[ROW_CLASS, 'relative isolate border-b border-divider last:border-b-0 hover:bg-inset']"
  >
    <ui-link
      :to="props.to"
      class="absolute inset-0 z-1"
      :aria-labelledby="rowId"
      unstyled
      data-testid="table-row-link"
    />

    <slot />
  </div>

  <div v-else-if="$slots.expand" class="border-b border-divider last:border-b-0" data-testid="table-row-expandable">
    <div :class="[ROW_CLASS, 'cursor-pointer hover:bg-inset']" @click="expanded = !expanded">
      <slot />

      <button
        type="button"
        class="inline-flex cursor-pointer bg-transparent text-muted outline-hidden focus-visible:text-header"
        :aria-expanded="expanded"
        :aria-label="expanded ? 'Hide details' : 'Show details'"
        @click.stop="expanded = !expanded"
      >
        <icon-expand-less v-if="expanded" class="size-4" />
        <icon-expand-more v-else class="size-4" />
      </button>
    </div>

    <div v-if="expanded" class="cursor-auto border-t border-divider" data-testid="table-row-expand">
      <slot name="expand" />
    </div>
  </div>

  <div v-else :class="[ROW_CLASS, 'border-b border-divider last:border-b-0']">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import IconExpandLess from '~icons/material-symbols/expand-less-rounded';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';

import UiLink from '../navigation/Link.vue';

const ROW_CLASS = 'grid grid-cols-(--table-columns) items-center gap-4 px-6 py-3 transition-colors duration-150';

/** With `#expand`, the row ends in a chevron cell, so `columns` needs a track for it. */
const expanded = defineModel<boolean>('expanded', { default: false });

const props = defineProps({
  /** Content that takes its own clicks needs `relative z-2` to sit above the row's link. */
  to: {
    type: String,
    default: undefined,
  },
});

const rowId = useId();
</script>
