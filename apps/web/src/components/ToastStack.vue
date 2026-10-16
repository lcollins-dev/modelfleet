<template>
  <teleport :to="modalStore.top ?? 'body'">
    <div class="fixed bottom-3 right-4 z-70 flex max-w-[calc(100%-2rem)] flex-col items-end" aria-live="polite">
      <transition-group
        enter-active-class="overflow-hidden transition-all duration-300 ease-out"
        leave-active-class="overflow-hidden transition-all duration-300 ease-in"
        enter-from-class="mt-0 max-h-0 translate-x-full opacity-0"
        leave-to-class="mt-0 max-h-0 translate-x-full opacity-0"
        enter-to-class="max-h-screen"
        leave-from-class="max-h-screen"
      >
        <div
          v-for="notification of notificationStore.notifications"
          :key="notification.id"
          class="relative mt-3 w-80 max-w-full rounded-xl border border-divider bg-popover px-3.5 text-sm text-normal"
          :data-testid="`notification-${notification.type}`"
        >
          <ui-disc-icon
            :icon="SEVERITY_ICONS[notification.type]"
            :size="18"
            class="absolute left-3.5 top-3 text-popover"
            :class="SEVERITY_DISC_CLASSES[notification.type]"
          />

          <div class="ml-7 py-3">
            <div v-if="notification.title !== null" class="mb-1 pr-5 font-semibold text-header">
              {{ notification.title }}
            </div>

            <div :class="{ 'pr-5': notification.title === null }">
              <template v-if="typeof notification.content === 'string'">{{ notification.content }}</template>
              <component :is="notification.content" v-else />
            </div>
          </div>

          <ui-icon-button
            :icon="IconClose"
            label="Close"
            size="sm"
            class="absolute right-2.5 top-2.5"
            @click="notificationStore.clearNotification(notification.id)"
          />
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import IconClose from '~icons/material-symbols/close-rounded';

import { useModalStore } from '@/stores/modal';
import { useNotificationStore } from '@/stores/notification';

import { UiDiscIcon, UiIconButton } from '@/components/ui';
import { SEVERITY_DISC_CLASSES, SEVERITY_ICONS } from '@/components/ui/feedback/severity';

const modalStore = useModalStore();
const notificationStore = useNotificationStore();
</script>
