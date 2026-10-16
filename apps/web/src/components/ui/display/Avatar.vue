<template>
  <span
    class="inline-flex shrink-0 select-none items-center justify-center font-medium leading-none"
    :class="[SIZE_CLASSES[props.size], TYPE_CLASSES[props.type], props.round ? 'rounded-full' : 'rounded-lg']"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

export type AvatarSize = 'sm' | 'md' | 'lg';
type AvatarType = 'primary' | 'gray' | 'brand';

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'size-7 text-xs',
  md: 'size-8 text-sm',
  lg: 'size-11 text-lg',
};

const TYPE_CLASSES: Record<AvatarType, string> = {
  primary: 'bg-primary-soft text-accent',
  gray: 'bg-emphasis text-muted',
  brand: 'bg-brand-tile font-semibold text-brand-accent',
};

const props = defineProps({
  size: {
    type: String as PropType<AvatarSize>,
    default: 'md',
  },
  type: {
    type: String as PropType<AvatarType>,
    default: 'primary',
  },
  round: {
    type: Boolean,
    default: false,
  },
});
</script>
