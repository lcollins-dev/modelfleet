<template>
  <div class="flex min-h-screen flex-col">
    <app-header
      :show-menu-button="hasSidebar && isNarrow"
      :menu-open="sidebarOpen"
      :brand-title="Config.VERSION"
      @menu="toggleSidebar"
    >
      <template #brand>
        <app-logo />
      </template>

      <template #actions>
        <slot name="actions" />
      </template>
    </app-header>

    <div class="flex flex-1">
      <app-sidebar v-if="hasSidebar && !isNarrow" :sections="props.sections">
        <template v-if="$slots['sidebar-footer']" #footer>
          <slot name="sidebar-footer" />
        </template>
      </app-sidebar>

      <main class="flex min-w-0 flex-1 flex-col px-4 pb-6 pt-6 sm:px-7 sm:pt-8">
        <div class="flex-1">
          <slot />
        </div>

        <app-footer class="pt-6" />
      </main>
    </div>

    <template v-if="hasSidebar && isNarrow && sidebarOpen">
      <div
        class="fixed inset-x-0 bottom-0 top-14 z-40 animate-fade-in bg-overlay"
        aria-hidden="true"
        data-testid="sidebar-scrim"
        @click="closeSidebar"
      ></div>

      <div class="fixed bottom-0 left-0 top-14 z-40 flex" data-testid="sidebar-drawer">
        <app-sidebar :sections="props.sections">
          <template v-if="$slots['sidebar-footer']" #footer>
            <slot name="sidebar-footer" />
          </template>
        </app-sidebar>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onKeyStroke, useWindowSize } from '@vueuse/core';
import { computed, PropType, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { Config } from '@/Config';

import AppFooter from './AppFooter.vue';
import AppHeader from './AppHeader.vue';
import AppLogo from './AppLogo.vue';
import AppSidebar, { INavSection } from './AppSidebar.vue';

const NARROW_WIDTH = 1024;

/** Empty `sections` leave out the sidebar and its menu button. */
const props = defineProps({
  sections: {
    type: Array as PropType<INavSection[]>,
    default: () => [],
  },
});

const route = useRoute();
const { width } = useWindowSize();

const hasSidebar = computed(() => props.sections.length > 0);
const isNarrow = computed(() => width.value < NARROW_WIDTH);
const sidebarOpen = ref(false);

const toggleSidebar = () => {
  sidebarOpen.value = !sidebarOpen.value;
};

const closeSidebar = () => {
  sidebarOpen.value = false;
};

onKeyStroke('Escape', () => {
  if (sidebarOpen.value) {
    closeSidebar();
  }
});

watch([() => route.path, isNarrow], closeSidebar);
</script>
