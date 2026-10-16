<template>
  <dialog
    ref="dialog"
    class="m-auto w-full rounded-xl border border-divider bg-surface p-0 text-normal outline-hidden backdrop:animate-fade-in backdrop:bg-overlay"
    :aria-labelledby="titleId"
    autofocus
    @cancel.prevent="close"
    @close="onClose"
    @mousedown="onMousedown"
    @click="onClick"
  >
    <template v-if="show">
      <div class="flex items-center gap-2.5 px-6 pb-3 pt-5">
        <div v-if="$slots.icon" class="flex shrink-0">
          <slot name="icon" />
        </div>

        <h2 :id="titleId" class="m-0 min-w-0 flex-1 wrap-anywhere text-lg font-semibold text-header">
          {{ props.title }}
        </h2>

        <ui-icon-button :icon="IconClose" label="Close" size="sm" @click="close" />
      </div>

      <div class="px-6 pb-5">
        <slot />
      </div>
    </template>
  </dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId, useTemplateRef, watch } from 'vue';
import IconClose from '~icons/material-symbols/close-rounded';

import { useModalStore } from '@/stores/modal';

import UiIconButton from '../action/IconButton.vue';

const show = defineModel<boolean>('show', { required: true });

const props = defineProps({
  title: {
    type: String,
    required: true,
  },
});

const modalStore = useModalStore();

const dialog = useTemplateRef('dialog');

const titleId = useId();

const sync = () => {
  if (dialog.value === null) {
    return;
  }

  if (show.value && !dialog.value.open) {
    dialog.value.showModal();
    modalStore.open(dialog.value);
  } else if (!show.value && dialog.value.open) {
    dialog.value.close();
    forget();
  }
};

const forget = () => {
  if (dialog.value !== null) {
    modalStore.close(dialog.value);
  }
};

onMounted(sync);
watch(show, sync, { flush: 'post' });
onBeforeUnmount(forget);

const close = () => {
  show.value = false;
};

// The browser can close a dialog itself, such as through a `<form method="dialog">`, without a cancel event.
const onClose = () => {
  forget();
  close();
};

// Keep the dialog unpadded: a click on the dialog element itself is a backdrop click, if the press began there too and
// is not a text selection dragged out of the card.
let pressedBackdrop = false;

const onMousedown = (event: MouseEvent) => {
  pressedBackdrop = event.target === dialog.value;
};

const onClick = (event: MouseEvent) => {
  if (pressedBackdrop && event.target === dialog.value) {
    close();
  }
};
</script>
