import { defineStore } from 'pinia';
import { computed, shallowRef } from 'vue';

import { IDialogOptions, IOpenDialog } from '@/types/dialog';

export const useDialogStore = defineStore('dialog', () => {
  const dialogs = shallowRef<IOpenDialog[]>([]);

  const top = computed(() => dialogs.value.at(-1) ?? null);

  let nextDialogId = 0;

  /** Never rejects. A dialog opened over another shows until it closes, then the one below shows again. */
  function confirm(options: IDialogOptions): Promise<boolean> {
    return new Promise(resolve => {
      dialogs.value = [...dialogs.value, { id: nextDialogId++, options, resolve }];
    });
  }

  function close(dialog: IOpenDialog, confirmed: boolean) {
    dialog.resolve(confirmed);
    dialogs.value = dialogs.value.filter(open => open !== dialog);
  }

  return { dialogs, top, confirm, close };
});
