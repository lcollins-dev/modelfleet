import { MaybeComputedElementRef, onClickOutside } from '@vueuse/core';
import { MaybeRefOrGetter, ref, toValue } from 'vue';

import { firstEnabledIndex, IFlatOption, lastEnabledIndex, stepIndex } from './selectOptions';

interface IListboxConfig<T extends string> {
  /** Clicks outside this element close the listbox. */
  root: MaybeComputedElementRef;
  /** The id of a listbox rendered outside the root, whose clicks leave it open. */
  listboxId?: string;
  options: MaybeRefOrGetter<IFlatOption<T>[]>;
  pick: (index: number) => void;
  startIndex?: () => number;
  /** True while the combobox takes typed text, which keeps Space, Home and End for the text. */
  typing?: MaybeRefOrGetter<boolean>;
  onClose?: () => void;
}

export const useListbox = <T extends string>(config: IListboxConfig<T>) => {
  const open = ref(false);
  const activeIndex = ref(-1);

  const show = () => {
    if (open.value) {
      return;
    }

    activeIndex.value = config.startIndex?.() ?? firstEnabledIndex(toValue(config.options));
    open.value = true;
  };

  const close = () => {
    open.value = false;
    config.onClose?.();
  };

  const toggle = () => {
    if (open.value) {
      close();
    } else {
      show();
    }
  };

  const pickOrShow = () => {
    if (open.value) {
      config.pick(activeIndex.value);
    } else {
      show();
    }
  };

  onClickOutside(config.root, close, {
    ignore: config.listboxId === undefined ? [] : [`[id="${config.listboxId}"]`],
  });

  const onKeydown = (event: KeyboardEvent) => {
    const options = toValue(config.options);
    const typing = toValue(config.typing) ?? false;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();

        if (open.value) {
          activeIndex.value = stepIndex(options, activeIndex.value, event.key === 'ArrowDown' ? 1 : -1);
        } else {
          show();
        }
        break;

      case 'Home':
      case 'End':
        if (open.value && !typing) {
          event.preventDefault();
          activeIndex.value = event.key === 'Home' ? firstEnabledIndex(options) : lastEnabledIndex(options);
        }
        break;

      case 'Enter':
        event.preventDefault();
        pickOrShow();
        break;

      case ' ':
        if (!typing) {
          event.preventDefault();
          pickOrShow();
        }
        break;

      case 'Escape':
        if (open.value) {
          event.preventDefault();
          close();
        }
        break;

      case 'Tab':
        close();
        break;
    }
  };

  return { open, activeIndex, show, close, toggle, onKeydown };
};
