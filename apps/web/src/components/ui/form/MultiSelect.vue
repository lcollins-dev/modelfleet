<template>
  <div ref="root" class="relative w-full" :class="$attrs.class">
    <input-box :active="open" :disabled="props.disabled" chevron @mousedown="onFieldMousedown">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1" :class="{ '-ml-1.5 py-1': value.length > 0 }">
        <span
          v-for="picked of value"
          :key="picked"
          class="inline-flex max-w-full items-center gap-0.5 rounded-full bg-emphasis py-px pl-2 text-xs leading-5"
          :class="props.disabled ? 'pr-2 text-muted' : 'pr-0.5 text-highlight'"
          data-testid="multi-select-chip"
        >
          <span class="truncate">{{ labelOf(picked) }}</span>

          <button
            v-if="!props.disabled"
            type="button"
            tabindex="-1"
            class="inline-flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded-full bg-transparent text-muted outline-hidden hover:bg-inset hover:text-header"
            :aria-label="`Remove ${labelOf(picked)}`"
            data-chip-remove
            @click="remove(picked)"
          >
            <icon-close class="size-3.5" />
          </button>
        </span>

        <input
          ref="input"
          v-bind="inputAttrs"
          v-model="query"
          type="text"
          role="combobox"
          class="h-5 min-w-16 flex-1 bg-transparent caret-primary outline-hidden placeholder:text-muted read-only:cursor-pointer read-only:caret-transparent disabled:cursor-not-allowed"
          :class="{ 'ml-1': value.length > 0 }"
          :placeholder="value.length > 0 ? undefined : props.placeholder"
          :readonly="!props.searchable"
          :disabled="props.disabled"
          autocomplete="off"
          :aria-autocomplete="props.searchable ? 'list' : undefined"
          aria-haspopup="listbox"
          :aria-expanded="open"
          :aria-controls="open ? listboxId : undefined"
          :aria-activedescendant="open && activeIndex !== -1 ? optionId(listboxId, activeIndex) : undefined"
          @input="show"
          @keydown="onKeydown"
        />
      </div>
    </input-box>

    <template v-if="props.name">
      <input v-for="picked of value" :key="picked" type="hidden" :name="props.name" :value="picked" />
    </template>

    <select-listbox
      v-if="open"
      :id="listboxId"
      :anchor="root"
      :options="shown"
      :selected="value"
      :active-index="activeIndex"
      multiple
      @pick="toggleAt"
      @activate="activeIndex = $event"
      @hidden="close"
    />
  </div>
</template>

<script setup lang="ts" generic="TValue extends string">
import { computed, ref, useAttrs, useId, useTemplateRef, watch } from 'vue';
import IconClose from '~icons/material-symbols/close-rounded';

import InputBox from './InputBox.vue';
import SelectListbox from './SelectListbox.vue';
import { inputAttrsOf } from './fieldInput';
import { firstEnabledIndex, flattenOptions, optionAt, optionId, SelectOptions } from './selectOptions';
import { useListbox } from './useListbox';

defineOptions({ inheritAttrs: false });

const value = defineModel<TValue[]>('value', { default: () => [] });

const props = withDefaults(
  defineProps<{
    options: SelectOptions<TValue>;
    placeholder?: string;
    disabled?: boolean;
    searchable?: boolean;
    /** Posts each value with a native form through a hidden input. */
    name?: string;
  }>(),
  {
    placeholder: 'Select...',
    disabled: false,
    searchable: true,
    name: undefined,
  }
);

const attrs = useAttrs();

const inputAttrs = computed(() => inputAttrsOf(attrs));

const listboxId = `${useId()}-listbox`;

const input = useTemplateRef('input');

const query = ref('');

const options = computed(() => flattenOptions(props.options));

const shown = computed(() => {
  const search = query.value.trim().toLowerCase();

  if (search === '') {
    return options.value;
  }

  return options.value.filter(option => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(search));
});

const labelOf = (picked: TValue): string => options.value.find(option => option.value === picked)?.label ?? picked;

const remove = (picked: TValue) => {
  value.value = value.value.filter(other => other !== picked);
};

const toggleAt = (index: number) => {
  const option = optionAt(shown.value, index);

  if (option === undefined || option.disabled === true) {
    return;
  }

  value.value = value.value.includes(option.value)
    ? value.value.filter(other => other !== option.value)
    : [...value.value, option.value];
  query.value = '';
};

const root = useTemplateRef('root');

const listbox = useListbox({
  root,
  listboxId,
  options: shown,
  pick: toggleAt,
  typing: () => props.searchable,
  onClose: () => {
    query.value = '';
  },
});

const { open, activeIndex, show, close, toggle } = listbox;

watch(shown, () => {
  activeIndex.value = firstEnabledIndex(shown.value);
});

const onFieldMousedown = (event: MouseEvent) => {
  if (props.disabled || (event.target instanceof Element && event.target.closest('[data-chip-remove]') !== null)) {
    return;
  }

  event.preventDefault();
  input.value?.focus();
  toggle();
};

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Backspace' && query.value === '' && value.value.length > 0) {
    value.value = value.value.slice(0, -1);
    return;
  }

  listbox.onKeydown(event);
};
</script>
