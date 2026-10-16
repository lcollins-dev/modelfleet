<template>
  <header
    class="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 border-b border-divider bg-surface pl-3.5 pr-3"
  >
    <ui-icon-button
      v-if="props.showMenuButton"
      :icon="IconMenu"
      label="Menu"
      tone="strong"
      :aria-expanded="props.menuOpen"
      @click="emit('menu')"
    />

    <ui-link
      class="flex items-center px-1 py-1.5 hover:text-header"
      :to="props.brandTo"
      :title="props.brandTitle"
      unstyled
    >
      <slot name="brand" />
    </ui-link>

    <div class="grow"></div>

    <slot name="actions" />
  </header>
</template>

<script setup lang="ts">
import IconMenu from '~icons/material-symbols/menu-rounded';

import { UiIconButton, UiLink } from '@/components/ui';

const props = defineProps({
  showMenuButton: {
    type: Boolean,
    default: false,
  },
  menuOpen: {
    type: Boolean,
    default: false,
  },
  brandTo: {
    type: String,
    default: '/',
  },
  brandTitle: {
    type: String,
    default: undefined,
  },
});

const emit = defineEmits<{
  menu: [];
}>();
</script>
