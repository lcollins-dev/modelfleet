<template>
  <div :class="{ 'sticky top-0 z-3 bg-surface': props.sticky }" data-testid="table-head">
    <div
      class="grid grid-cols-(--table-columns) items-center gap-4 border-b border-divider bg-inset px-6 py-2 text-xs font-medium uppercase tracking-wider text-muted"
    >
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  /** The surface beneath stops rows showing through the head's translucent tint. */
  sticky: {
    type: Boolean,
    default: false,
  },
});
</script>
