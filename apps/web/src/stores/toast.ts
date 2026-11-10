import { defineStore } from 'pinia';
import { ref } from 'vue';

import { Toast } from '@/types/toast';

const TOAST_TIMEOUT_MS = 3800;

const MAX_SHOWN = 4;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  let nextToastId = 0;

  function addToast(title: string, content = '') {
    const toast = new Toast(nextToastId++, title, content);

    for (const repeat of toasts.value.filter(shown => shown.title === title && shown.content === content)) {
      clearToast(repeat.id);
    }

    toasts.value.push(toast);

    for (const oldest of toasts.value.slice(0, -MAX_SHOWN)) {
      clearToast(oldest.id);
    }

    toast.timeoutHandle = setTimeout(() => clearToast(toast.id), TOAST_TIMEOUT_MS);

    return toast.id;
  }

  function clearToast(id: number) {
    const toastIndex = toasts.value.findIndex(toast => toast.id === id);

    if (toastIndex !== -1) {
      const toast = toasts.value[toastIndex];

      if (toast.timeoutHandle !== null) {
        clearTimeout(toast.timeoutHandle);
        toast.timeoutHandle = null;
      }

      toasts.value.splice(toastIndex, 1);
    }
  }

  return {
    toasts,
    addToast,
    clearToast,
  };
});
