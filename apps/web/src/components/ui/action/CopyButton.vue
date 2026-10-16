<template>
  <ui-button :type="props.bordered ? 'outline' : 'text'" @click="doCopy">
    <template #icon>
      <icon-check v-if="copied" class="size-4" />
      <icon-copy v-else class="size-4" />
    </template>
    {{ copied ? props.copiedLabel : props.label }}
  </ui-button>
</template>

<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import IconCheck from '~icons/material-symbols/check-rounded';
import IconCopy from '~icons/material-symbols/content-copy-outline-rounded';

import { Notification, NotificationType } from '@/types/notification';

import { useLogService } from '@/services/LogService';
import { useNotificationStore } from '@/stores/notification';

import UiButton from './Button.vue';

const COPIED_RESET_MS = 1600;
const FAILURE_CLOSE_MS = 4000;

const logService = useLogService();
const logger = logService.createLogger('components/ui/action/CopyButton');

const notificationStore = useNotificationStore();

const props = defineProps({
  value: {
    type: String,
    required: true,
  },
  label: {
    type: String,
    default: 'Copy',
  },
  copiedLabel: {
    type: String,
    default: 'Copied',
  },
  bordered: {
    type: Boolean,
    default: false,
  },
  /** Shown when the browser refuses clipboard access, where the user has to fall back to copying by hand. */
  failureContent: {
    type: String,
    default: 'Your browser blocked clipboard access. Copy the value by hand instead.',
  },
});

const emit = defineEmits<{
  failed: [];
}>();

const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

const doCopy = () => {
  // navigator.clipboard is undefined outside a secure context (a plain-HTTP host); the chain turns that throw into a
  // rejection.
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(props.value))
    .then(() => {
      copied.value = true;

      if (resetTimer !== null) {
        clearTimeout(resetTimer);
      }

      resetTimer = setTimeout(() => {
        copied.value = false;
        resetTimer = null;
      }, COPIED_RESET_MS);
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doCopy(): Failed to copy to the clipboard');

      notificationStore.addNotification(
        new Notification(props.failureContent, NotificationType.ERROR, FAILURE_CLOSE_MS, "Couldn't copy", true)
      );

      emit('failed');
    });
};

onUnmounted(() => {
  if (resetTimer !== null) {
    clearTimeout(resetTimer);
  }
});
</script>
