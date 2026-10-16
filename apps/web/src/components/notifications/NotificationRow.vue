<template>
  <div
    class="relative flex gap-3 p-2.5 [&+&]:border-t [&+&]:border-divider"
    :class="{ 'hover:bg-inset has-focus-visible:bg-inset': hasPage }"
    data-testid="notification-row"
  >
    <ui-disc-icon
      :icon="SEVERITY_ICONS[severity]"
      :size="18"
      :icon-size="severityIconSize"
      class="mt-px text-popover"
      :class="SEVERITY_DISC_CLASSES[severity]"
    />

    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <div class="flex items-start gap-2">
        <!-- The title's ::after covers the row, so a click anywhere but Dismiss opens the page. -->
        <button
          v-if="hasPage"
          type="button"
          class="min-w-0 flex-1 cursor-pointer bg-transparent text-left font-medium text-highlight outline-hidden after:absolute after:inset-0"
          @click="openPage"
        >
          {{ props.notification.notificationType.name }}
        </button>

        <span v-else class="min-w-0 flex-1 font-medium text-highlight">
          {{ props.notification.notificationType.name }}
        </span>

        <span class="relative flex h-5 flex-none items-center justify-center">
          <ui-spinner v-if="clearing" :size="16" type="current" class="text-muted" />

          <ui-icon-button v-else :icon="IconClose" label="Dismiss" size="sm" @click="clear" />
        </span>
      </div>

      <div v-dompurify-html="props.notification.desc" class="text-pretty text-normal"></div>

      <div class="mt-0.5 whitespace-nowrap font-mono text-xs text-muted">
        {{ formatRelativeDate(props.notification.createdDate) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue';
import { useRouter } from 'vue-router';
import IconClose from '~icons/material-symbols/close-rounded';

import { NotificationDto, NotificationSeverity } from '@libs/dto';

import { formatRelativeDate } from '@/utils/format/date';

import { useLogService } from '@/services/LogService';
import { useNotificationService } from '@/services/api/NotificationService';

import { UiDiscIcon, UiIconButton, UiSpinner } from '@/components/ui';
import { SEVERITY_DISC_CLASSES, SEVERITY_ICONS } from '@/components/ui/feedback/severity';

const logService = useLogService();
const logger = logService.createLogger('components/notifications/NotificationRow');

const props = defineProps({
  notification: {
    type: Object as PropType<NotificationDto>,
    required: true,
  },
});

const emit = defineEmits<{
  cleared: [];
  opened: [];
}>();

const router = useRouter();

const notificationService = useNotificationService();

const clearing = ref(false);

const pageUrl = computed(() => props.notification.notificationType.pageUrl ?? '');
const hasPage = computed(() => pageUrl.value !== '');

const severity = computed(() => props.notification.notificationType.severity);
const severityIconSize = computed(() => (severity.value === NotificationSeverity.WARNING ? 12 : 14));

const clear = () => {
  clearing.value = true;

  notificationService
    .clearNotification(props.notification.id)
    .then(() => {
      emit('cleared');
    })
    .finally(() => {
      clearing.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'clear(): Failed to clear the notification');
    });
};

const openPage = () => {
  if (!hasPage.value) {
    return;
  }

  emit('opened');

  router.push(pageUrl.value).catch((error: unknown) => {
    logger.error({ error }, 'openPage(): Failed to navigate to the notification page');
  });

  clear();
};
</script>
