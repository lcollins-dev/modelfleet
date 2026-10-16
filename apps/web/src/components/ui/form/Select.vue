<template>
  <div ref="root" class="relative w-full" :class="$attrs.class">
    <input-box :active="open" :disabled="props.disabled" chevron>
      <input
        v-if="props.searchable"
        v-bind="triggerAttrs"
        :value="open ? query : (selected?.label ?? '')"
        type="text"
        role="combobox"
        class="min-w-0 flex-1 cursor-pointer self-stretch bg-transparent caret-primary outline-hidden placeholder:text-muted focus:cursor-text disabled:cursor-not-allowed"
        :placeholder="open && selected !== undefined ? selected.label : props.placeholder"
        :disabled="props.disabled"
        autocomplete="off"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="open ? listboxId : undefined"
        :aria-activedescendant="open && activeIndex !== -1 ? optionId(listboxId, activeIndex) : undefined"
        :aria-busy="props.loading || undefined"
        @click="show"
        @input="onSearchInput"
        @keydown="onKeydown"
      />

      <!-- The after: overlay spreads the button's hit area over the box's padding and chevron. -->
      <button
        v-else
        v-bind="triggerAttrs"
        type="button"
        role="combobox"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 self-stretch bg-transparent text-left outline-hidden after:absolute after:inset-0 disabled:cursor-not-allowed"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :aria-controls="open ? listboxId : undefined"
        :aria-activedescendant="open && activeIndex !== -1 ? optionId(listboxId, activeIndex) : undefined"
        :aria-busy="props.loading || undefined"
        :disabled="props.disabled"
        @click="toggle"
        @keydown="onKeydown"
      >
        <component :is="selected.icon" v-if="selected?.icon" class="size-4 text-muted" />

        <span class="min-w-0 flex-1 truncate" :class="{ 'text-muted': selected === undefined }">
          {{ selected?.label ?? props.placeholder }}
        </span>
      </button>

      <ui-spinner v-if="props.loading" :size="14" class="shrink-0 text-muted" />

      <button
        v-if="showClear"
        type="button"
        tabindex="-1"
        class="relative z-10 hidden shrink-0 cursor-pointer items-center justify-center bg-transparent outline-hidden group-focus-within:flex group-hover:flex"
        aria-label="Clear"
        @mousedown.prevent
        @click="clear"
      >
        <ui-disc-icon :icon="IconClose" :size="16" class="bg-muted text-surface opacity-70" />
      </button>
    </input-box>

    <input v-if="props.name" type="hidden" :name="props.name" :value="value ?? ''" />

    <select-listbox
      v-if="open"
      :id="listboxId"
      :anchor="root"
      :options="shown"
      :selected="value === null ? [] : [value]"
      :active-index="activeIndex"
      :empty-text="props.loading ? 'Loading...' : undefined"
      @pick="pick"
      @activate="activeIndex = $event"
      @hidden="close"
    >
      <template v-if="$slots.optionExtra" #optionExtra="slotProps">
        <slot name="optionExtra" v-bind="slotProps" />
      </template>
    </select-listbox>
  </div>
</template>

<script setup lang="ts" generic="TValue extends string">
import { computed, ref, useAttrs, useId, useTemplateRef, watch } from 'vue';
import IconClose from '~icons/material-symbols/close-rounded';

import UiDiscIcon from '../display/DiscIcon.vue';
import UiSpinner from '../feedback/Spinner.vue';
import InputBox from './InputBox.vue';
import SelectListbox from './SelectListbox.vue';
import { inputAttrsOf } from './fieldInput';
import { firstEnabledIndex, flattenOptions, IFlatOption, optionAt, optionId, SelectOptions } from './selectOptions';
import { useListbox } from './useListbox';

defineOptions({ inheritAttrs: false });

const value = defineModel<TValue | null>('value', { default: null });

const props = withDefaults(
  defineProps<{
    options: SelectOptions<TValue>;
    placeholder?: string;
    disabled?: boolean;
    /** Posts the value with a native form through a hidden input. */
    name?: string;
    clearable?: boolean;
    searchable?: boolean;
    /** With `searchable`, leaves the narrowing to the parent: each change of the typed text emits `search`. */
    remote?: boolean;
    loading?: boolean;
  }>(),
  {
    placeholder: 'Select...',
    disabled: false,
    name: undefined,
    clearable: false,
    searchable: false,
    remote: false,
    loading: false,
  }
);

const emit = defineEmits<{
  search: [query: string];
}>();

defineSlots<{
  optionExtra?(slotProps: { option: IFlatOption<TValue> }): unknown;
}>();

const attrs = useAttrs();

const triggerAttrs = computed(() => inputAttrsOf(attrs));

const listboxId = `${useId()}-listbox`;

const query = ref('');

const options = computed(() => flattenOptions(props.options));

const shown = computed(() => {
  const term = query.value.trim().toLowerCase();

  if (props.remote || term === '') {
    return options.value;
  }

  return options.value.filter(option => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(term));
});

const selected = computed(() => options.value.find(option => option.value === value.value));

const showClear = computed(() => props.clearable && !props.disabled && value.value !== null);

const setQuery = (next: string) => {
  if (next === query.value) {
    return;
  }

  query.value = next;

  if (props.remote) {
    emit('search', next);
  }
};

const pick = (index: number) => {
  const option = optionAt(shown.value, index);

  if (option === undefined || option.disabled === true) {
    return;
  }

  value.value = option.value;
  close();
};

const clear = () => {
  value.value = null;
  close();
};

const root = useTemplateRef('root');

const listbox = useListbox({
  root,
  listboxId,
  options: shown,
  pick,
  typing: () => props.searchable,
  startIndex: () => {
    const selectedIndex = shown.value.findIndex(option => option.value === value.value);

    return selectedIndex !== -1 && shown.value[selectedIndex].disabled !== true
      ? selectedIndex
      : firstEnabledIndex(shown.value);
  },
  onClose: () => {
    setQuery('');
  },
});

const { open, activeIndex, show, close, toggle, onKeydown } = listbox;

const onSearchInput = (event: Event) => {
  if (event.target instanceof HTMLInputElement) {
    setQuery(event.target.value);
    show();
  }
};

watch(shown, () => {
  if (query.value !== '') {
    activeIndex.value = firstEnabledIndex(shown.value);
  }
});
</script>
