<template>
  <component :is="layoutComponent">
    <router-view></router-view>
  </component>

  <dialog-host />

  <!-- Inside the newest open modal, since a modal makes the page outside it inert -->
  <teleport :to="modalStore.top ?? 'body'">
    <div class="pointer-events-none fixed inset-x-4 bottom-3 z-70 flex flex-col" aria-live="polite">
      <toast-stack />

      <notification-stack />
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import { useModalStore } from '@/stores/modal';
import { useThemeStore } from '@/stores/theme';
import { useUserStore } from '@/stores/user';

import NotificationStack from '@/components/NotificationStack.vue';
import ToastStack from '@/components/ToastStack.vue';
import DialogHost from '@/components/dialog/DialogHost.vue';
import { Layout, LAYOUT_COMPONENTS } from '@/components/layouts';

// Created here so the stored theme reaches the root element on every route, signed in or not.
useThemeStore();

const route = useRoute();

const modalStore = useModalStore();

const userStore = useUserStore();

const layoutComponent = computed(
  () => LAYOUT_COMPONENTS[route.meta.layout ?? (userStore.loggedIn ? Layout.DEFAULT : Layout.LOGGED_OUT)]
);
</script>
