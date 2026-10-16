import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';

/**
 * The modal dialogs open now, oldest first. A modal sits in the browser's top layer and makes the page outside it inert,
 * so anything that must stay above it and usable, such as toasts, renders inside the newest one.
 */
export const useModalStore = defineStore('modal', () => {
  const openModals = shallowRef<HTMLDialogElement[]>([]);

  const top = computed(() => openModals.value.at(-1) ?? null);

  function open(dialog: HTMLDialogElement) {
    openModals.value = [...openModals.value, dialog];
  }

  function close(dialog: HTMLDialogElement) {
    openModals.value = openModals.value.filter(open => open !== dialog);
  }

  return { openModals, top, open, close };
});
