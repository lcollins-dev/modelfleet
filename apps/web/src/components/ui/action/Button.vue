<template>
  <component
    :is="root.is"
    v-bind="root.attrs"
    class="relative h-8 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg border text-sm font-medium leading-none outline-hidden transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
    :class="[TYPE_CLASSES[props.type], props.block ? 'flex w-full' : 'inline-flex', props.square ? 'w-8' : 'px-3']"
    :aria-busy="props.loading || undefined"
    @click="onClick"
  >
    <span v-if="props.loading || $slots.icon" class="mr-1.5 flex size-4 items-center justify-center">
      <ui-spinner v-if="props.loading" :size="16" type="current" aria-hidden="true" />
      <slot v-else name="icon" />
    </span>

    <slot />
  </component>
</template>

<script setup lang="ts">
import { PropType, computed } from 'vue';
import { RouteLocationRaw, RouterLink } from 'vue-router';

import UiSpinner from '../feedback/Spinner.vue';

type ButtonType = 'primary' | 'outline' | 'text' | 'danger' | 'danger-outline';

const TYPE_CLASSES: Record<ButtonType, string> = {
  outline:
    'border-line bg-transparent text-highlight interactive:hover:border-line-strong interactive:hover:bg-inset interactive:hover:text-header interactive:focus:border-line-strong interactive:focus:bg-inset interactive:focus:text-header interactive:active:bg-emphasis',
  primary:
    'border-primary bg-primary text-on-primary interactive:hover:border-primary-hover interactive:hover:bg-primary-hover interactive:focus:border-primary-hover interactive:focus:bg-primary-hover interactive:active:border-primary-pressed interactive:active:bg-primary-pressed',
  text: 'border-transparent bg-transparent text-highlight interactive:hover:bg-inset interactive:focus:bg-inset interactive:active:bg-emphasis',
  danger:
    'border-error bg-error text-on-danger interactive:hover:brightness-110 interactive:focus-visible:brightness-110 interactive:active:brightness-95',
  'danger-outline':
    'border-error-line bg-transparent text-error interactive:hover:bg-error-soft interactive:focus-visible:bg-error-soft',
};

const props = defineProps({
  to: {
    type: [Object, String] as PropType<RouteLocationRaw>,
    default: undefined,
  },
  type: {
    type: String as PropType<ButtonType>,
    default: 'outline',
  },
  nativeType: {
    type: String as PropType<'button' | 'submit'>,
    default: 'button',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  block: {
    type: Boolean,
    default: false,
  },
  square: {
    type: Boolean,
    default: false,
  },
});

// An <a> has no disabled state, so a disabled link drops its href to stop navigating and leave the tab order.
const root = computed(() => {
  if (props.to === undefined) {
    return { is: 'button', attrs: { type: props.nativeType, disabled: props.disabled } };
  }

  if (props.disabled) {
    return { is: 'a', attrs: { role: 'link', 'aria-disabled': 'true' } };
  }

  return { is: RouterLink, attrs: { to: props.to } };
});

const emit = defineEmits<{
  click: [event: MouseEvent];
}>();

// A loading submit button still submits its form, so submit handlers keep their own loading guard.
const onClick = (event: MouseEvent) => {
  if (!props.loading && !props.disabled) {
    emit('click', event);
  }
};
</script>
