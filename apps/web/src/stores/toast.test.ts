import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from './toast';

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const titles = () => useToastStore().toasts.map(toast => toast.title);

  it('holds a toast with its title and text', () => {
    const toastStore = useToastStore();

    toastStore.addToast('Invite revoked', 'The link no longer works.');

    expect(toastStore.toasts).toEqual([
      expect.objectContaining({ title: 'Invite revoked', content: 'The link no longer works.' }),
    ]);
  });

  it('closes a toast on its own once its time is up', () => {
    vi.useFakeTimers();

    const toastStore = useToastStore();

    toastStore.addToast('Profile updated', 'Your changes have been saved.');

    vi.advanceTimersByTime(3799);
    expect(toastStore.toasts).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(toastStore.toasts).toHaveLength(0);
  });

  it('replaces a toast repeated before the first has gone', () => {
    const toastStore = useToastStore();

    toastStore.addToast('Node updated', 'gpu-a-01 is saved.');
    toastStore.addToast('Node updated', 'gpu-a-01 is saved.');

    expect(titles()).toEqual(['Node updated']);
  });

  it('keeps two toasts that share a sentence but not a title', () => {
    const toastStore = useToastStore();

    toastStore.addToast('Profile updated', 'Your changes have been saved.');
    toastStore.addToast('Settings saved', 'Your changes have been saved.');

    expect(titles()).toEqual(['Profile updated', 'Settings saved']);
  });

  it('drops the oldest toast once more than four are shown', () => {
    const toastStore = useToastStore();

    for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
      toastStore.addToast(title, 'Done.');
    }

    expect(titles()).toEqual(['Two', 'Three', 'Four', 'Five']);
  });

  it('cancels the pending timeout of a toast that is cleared', () => {
    vi.useFakeTimers();

    const toastStore = useToastStore();

    const id = toastStore.addToast('Profile updated', 'Your changes have been saved.');

    toastStore.clearToast(id);

    expect(vi.getTimerCount()).toBe(0);
  });
});
