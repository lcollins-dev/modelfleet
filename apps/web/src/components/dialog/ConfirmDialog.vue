<template>
  <ui-modal :show="true" class="max-w-md" :title="props.options.title" data-testid="dialog" @update:show="cancel">
    <template #icon>
      <ui-disc-icon
        :icon="SEVERITY_ICONS[severity]"
        :size="20"
        class="text-surface"
        :class="SEVERITY_DISC_CLASSES[severity]"
      />
    </template>

    <p v-if="typeof props.options.message === 'string'" class="mb-3 mt-0 wrap-anywhere leading-normal">
      {{ props.options.message }}
    </p>

    <div v-else class="mb-3 wrap-anywhere leading-normal" data-testid="dialog-message">
      <component :is="props.options.message" />
    </div>

    <ui-form-field
      v-if="props.options.confirmText !== undefined"
      v-slot="{ input }"
      :label="props.options.confirmTextLabel ?? `Type ${props.options.confirmText} to confirm`"
    >
      <ui-input v-model:value="typed" :placeholder="props.options.confirmText" v-bind="input" name="confirm-text" />
    </ui-form-field>

    <div class="flex justify-end gap-2">
      <ui-button @click="cancel">{{ props.options.cancelLabel ?? 'Cancel' }}</ui-button>
      <ui-button
        :type="props.options.type === DialogType.DANGER ? 'danger' : 'primary'"
        :disabled="!canConfirm"
        :loading="loading"
        data-testid="dialog-confirm"
        @click="accept"
      >
        {{ props.options.confirmLabel }}
      </ui-button>
    </div>
  </ui-modal>
</template>

<script setup lang="ts">
import { computed, PropType, ref } from 'vue';

import { DialogType, IDialogOptions } from '@/types/dialog';

import { useLogService } from '@/services/LogService';

import { UiButton, UiDiscIcon, UiFormField, UiInput, UiModal } from '@/components/ui';
import { Severity, SEVERITY_DISC_CLASSES, SEVERITY_ICONS } from '@/components/ui/feedback/severity';

const props = defineProps({
  options: {
    type: Object as PropType<IDialogOptions>,
    required: true,
  },
});

const emit = defineEmits<{
  close: [confirmed: boolean];
}>();

const logService = useLogService();
const logger = logService.createLogger('components/ConfirmDialog');

const severity = computed<Severity>(() => (props.options.type === DialogType.DANGER ? 'error' : props.options.type));

const typed = ref('');
const loading = ref(false);

const canConfirm = computed(() => {
  const confirmText = props.options.confirmText;

  return confirmText === undefined || typed.value.trim().toLowerCase() === confirmText.trim().toLowerCase();
});

const cancel = () => {
  emit('close', false);
};

const accept = () => {
  if (loading.value || !canConfirm.value) {
    return;
  }

  const action = props.options.action;

  if (action === undefined) {
    emit('close', true);
    return;
  }

  loading.value = true;

  action()
    .then(() => {
      emit('close', true);
    })
    .catch((error: unknown) => {
      logger.info({ error }, 'accept(): The dialog action failed');
      loading.value = false;
    });
};
</script>
