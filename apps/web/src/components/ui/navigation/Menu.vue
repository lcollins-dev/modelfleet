<template>
  <ui-popover :title="props.title" :subtitle="props.subtitle" class="min-w-48">
    <template #default="{ titleId }">
      <div
        ref="menu"
        role="menu"
        :aria-labelledby="titleId"
        :aria-label="titleId === undefined ? props.label : undefined"
        @keydown="onKeydown"
      >
        <ui-menu-item
          v-for="item of props.items"
          :key="item.key"
          :icon="item.icon"
          :danger="item.danger"
          role="menuitem"
          tabindex="-1"
          :data-testid="`menu-item-${item.key}`"
          @click="emit('select', item.key)"
        >
          {{ item.label }}
        </ui-menu-item>
      </div>
    </template>
  </ui-popover>
</template>

<script setup lang="ts">
import { type Component, onMounted, PropType, useTemplateRef } from 'vue';

import UiMenuItem from './MenuItem.vue';
import UiPopover from './Popover.vue';

export interface IMenuItem {
  key: string;
  label: string;
  icon?: Component;
  danger?: boolean;
}

const props = defineProps({
  items: {
    type: Array as PropType<IMenuItem[]>,
    required: true,
  },
  title: {
    type: String,
    default: undefined,
  },
  subtitle: {
    type: String,
    default: undefined,
  },
  /** Names the menu when it has no title. */
  label: {
    type: String,
    default: undefined,
  },
});

const emit = defineEmits<{
  select: [key: string];
}>();

const menu = useTemplateRef('menu');

const menuItems = (): HTMLElement[] => Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

const focusItem = (index: number) => {
  const items = menuItems();

  if (items.length > 0) {
    items[(index + items.length) % items.length].focus();
  }
};

const onKeydown = (event: KeyboardEvent) => {
  const items = menuItems();
  const current = items.findIndex(item => item === document.activeElement);

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusItem(current + 1);
      break;

    case 'ArrowUp':
      event.preventDefault();
      focusItem(current === -1 ? -1 : current - 1);
      break;

    case 'Home':
      event.preventDefault();
      focusItem(0);
      break;

    case 'End':
      event.preventDefault();
      focusItem(-1);
      break;
  }
};

onMounted(() => {
  focusItem(0);
});
</script>
