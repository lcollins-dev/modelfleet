import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useModalStore } from './modal';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('modal store', () => {
  it('tracks open modals with the newest on top', () => {
    const modalStore = useModalStore();
    const first = document.createElement('dialog');
    const second = document.createElement('dialog');

    modalStore.open(first);
    modalStore.open(second);

    expect(modalStore.openModals).toEqual([first, second]);
    expect(modalStore.top).toBe(second);
  });

  it('drops a closed modal and falls back to the one below', () => {
    const modalStore = useModalStore();
    const first = document.createElement('dialog');
    const second = document.createElement('dialog');

    modalStore.open(first);
    modalStore.open(second);
    modalStore.close(second);

    expect(modalStore.top).toBe(first);
  });

  it('has no top modal when none are open', () => {
    expect(useModalStore().top).toBeNull();
  });
});
