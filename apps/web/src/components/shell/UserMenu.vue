<template>
  <ui-dropdown v-model:open="open" @keydown.tab="open = false">
    <template #trigger="{ open: isOpen, toggle, panelId }">
      <button
        type="button"
        class="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-transparent pl-1 pr-2 text-sm text-highlight outline-hidden hover:bg-inset focus-visible:bg-inset"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        :aria-controls="isOpen ? panelId : undefined"
        data-testid="user-menu"
        @click="toggle"
      >
        <ui-avatar size="sm" round>{{ avatarInitial }}</ui-avatar>
        <span>{{ label }}</span>
        <icon-expand-more class="size-4 text-muted" aria-hidden="true" />
      </button>
    </template>

    <ui-menu :title="label" :subtitle="props.email" :items="props.items" @select="onSelect" />
  </ui-dropdown>
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue';
import IconExpandMore from '~icons/material-symbols/expand-more-rounded';

import { accountInitial, accountLabel } from '@/utils/accountLabel';

import { IMenuItem, UiAvatar, UiDropdown, UiMenu } from '@/components/ui';

const props = defineProps({
  name: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    required: true,
  },
  items: {
    type: Array as PropType<IMenuItem[]>,
    required: true,
  },
});

const emit = defineEmits<{
  select: [key: string];
}>();

const open = ref(false);

const label = computed(() => accountLabel(props.name, props.email));
const avatarInitial = computed(() => accountInitial(props.name, props.email));

const onSelect = (key: string) => {
  open.value = false;
  emit('select', key);
};
</script>
