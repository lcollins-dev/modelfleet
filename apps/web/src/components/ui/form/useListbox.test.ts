import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { flattenOptions } from './selectOptions';
import { useListbox } from './useListbox';

const OPTIONS = flattenOptions([
  { value: 'one', label: 'One', disabled: true },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
  { value: 'four', label: 'Four', disabled: true },
]);

const scopes: ReturnType<typeof effectScope>[] = [];

const setup = (config: { typing?: boolean; startIndex?: () => number } = {}) => {
  const root = document.createElement('div');
  document.body.append(root);

  const pick = vi.fn();
  const onClose = vi.fn();
  const scope = effectScope();
  scopes.push(scope);

  const listbox = scope.run(() => useListbox({ root: ref(root), options: OPTIONS, pick, onClose, ...config }));

  if (listbox === undefined) {
    throw new Error('The listbox did not set up');
  }

  return { listbox, pick, onClose, root };
};

const press = (onKeydown: (event: KeyboardEvent) => void, key: string) => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
  onKeydown(event);

  return event;
};

afterEach(() => {
  scopes.splice(0).forEach(scope => {
    scope.stop();
  });
  document.body.innerHTML = '';
});

describe('useListbox', () => {
  it('opens on the first enabled option, or the start index it is given', () => {
    const { listbox } = setup();

    listbox.show();

    expect(listbox.open.value).toBe(true);
    expect(listbox.activeIndex.value).toBe(1);

    const started = setup({ startIndex: () => 2 }).listbox;

    started.toggle();

    expect(started.activeIndex.value).toBe(2);
  });

  it('opens with the arrow keys, then steps past disabled options and wraps round', () => {
    const { listbox } = setup();

    press(listbox.onKeydown, 'ArrowDown');

    expect(listbox.open.value).toBe(true);
    expect(listbox.activeIndex.value).toBe(1);

    press(listbox.onKeydown, 'ArrowDown');
    expect(listbox.activeIndex.value).toBe(2);

    press(listbox.onKeydown, 'ArrowDown');
    expect(listbox.activeIndex.value).toBe(1);

    press(listbox.onKeydown, 'ArrowUp');
    expect(listbox.activeIndex.value).toBe(2);
  });

  it('jumps to the first and last enabled options with Home and End', () => {
    const { listbox } = setup();

    listbox.show();
    press(listbox.onKeydown, 'End');

    expect(listbox.activeIndex.value).toBe(2);

    press(listbox.onKeydown, 'Home');

    expect(listbox.activeIndex.value).toBe(1);
  });

  it('picks the active option with Enter and Space', () => {
    const { listbox, pick } = setup();

    press(listbox.onKeydown, 'Enter');

    expect(listbox.open.value).toBe(true);
    expect(pick).not.toHaveBeenCalled();

    press(listbox.onKeydown, 'Enter');
    press(listbox.onKeydown, ' ');

    expect(pick).toHaveBeenCalledTimes(2);
    expect(pick).toHaveBeenCalledWith(1);
  });

  it('leaves Space, Home and End to the text while typing', () => {
    const { listbox, pick } = setup({ typing: true });

    listbox.show();

    expect(press(listbox.onKeydown, ' ').defaultPrevented).toBe(false);
    expect(press(listbox.onKeydown, 'End').defaultPrevented).toBe(false);
    expect(listbox.activeIndex.value).toBe(1);
    expect(pick).not.toHaveBeenCalled();
  });

  it('closes on Escape, Tab and a click outside', async () => {
    const { listbox, onClose } = setup();

    listbox.show();
    press(listbox.onKeydown, 'Escape');

    expect(listbox.open.value).toBe(false);

    listbox.show();
    press(listbox.onKeydown, 'Tab');

    expect(listbox.open.value).toBe(false);

    listbox.show();
    await nextTick();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent('click', { bubbles: true }));

    expect(listbox.open.value).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
