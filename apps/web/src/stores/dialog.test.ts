import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { DialogType, IDialogOptions } from '@/types/dialog';

import { useDialogStore } from './dialog';

const OPTIONS: IDialogOptions = {
  type: DialogType.DANGER,
  title: 'Delete Sam?',
  message: "You can't undo this.",
  confirmLabel: 'Delete Account',
};

describe('useDialogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens a dialog and resolves whether it was confirmed when it closes', async () => {
    const dialogStore = useDialogStore();
    const answer = dialogStore.confirm(OPTIONS);

    expect(dialogStore.top?.options).toBe(OPTIONS);

    dialogStore.close(dialogStore.top!, true);

    expect(await answer).toBe(true);
    expect(dialogStore.top).toBeNull();
  });

  it('shows a dialog opened over another, then the one below again', async () => {
    const dialogStore = useDialogStore();
    const first = dialogStore.confirm(OPTIONS);
    const second = dialogStore.confirm({ ...OPTIONS, title: 'Run now?' });

    expect(dialogStore.top?.options.title).toBe('Run now?');

    dialogStore.close(dialogStore.top!, false);

    expect(await second).toBe(false);
    expect(dialogStore.top?.options.title).toBe('Delete Sam?');

    dialogStore.close(dialogStore.top!, true);

    expect(await first).toBe(true);
  });
});
