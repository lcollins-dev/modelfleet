<template>
  <nav
    class="sticky top-14 flex h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col self-start overflow-y-auto border-r border-divider bg-surface px-2.5 py-3.5"
    :aria-label="props.label"
  >
    <template v-for="(section, index) of props.sections" :key="section.title">
      <div v-if="index > 0" class="h-5 min-h-3 shrink" aria-hidden="true" />

      <div
        class="shrink-0 px-2.5 pb-1.5 text-xs font-medium uppercase tracking-wider text-muted"
        :class="{ 'pt-1': index === 0 }"
      >
        {{ section.title }}
      </div>

      <ui-nav-item
        v-for="item of section.items"
        :key="item.to"
        :to="item.to"
        :label="item.label"
        :icon="item.icon"
        :active="isActive(item)"
      />
    </template>

    <div v-if="$slots.footer" class="mt-auto pt-3">
      <slot name="footer" />
    </div>
  </nav>
</template>

<script setup lang="ts">
import { Component, PropType } from 'vue';
import { useRoute } from 'vue-router';

import { UiNavItem } from '@/components/ui';

export interface INavItem {
  label: string;
  icon?: Component;
  to: string;
}

export interface INavSection {
  title: string;
  items: INavItem[];
}

const props = defineProps({
  sections: {
    type: Array as PropType<INavSection[]>,
    required: true,
  },
  label: {
    type: String,
    default: 'Main',
  },
});

const route = useRoute();

const isActive = (item: INavItem): boolean => route.path === item.to || route.path.startsWith(`${item.to}/`);
</script>
