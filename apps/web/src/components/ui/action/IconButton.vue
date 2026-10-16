<template>
  <button
    :type="props.nativeType"
    class="inline-flex shrink-0 cursor-pointer items-center justify-center bg-transparent outline-hidden transition-colors duration-150"
    :class="[SIZE_CLASSES[props.size], props.tone === 'strong' ? 'text-highlight' : 'text-muted']"
    :aria-label="props.label"
    :title="props.label"
  >
    <component :is="props.icon" :class="props.size === 'sm' ? 'size-4' : 'size-5'" />
  </button>
</template>

<script setup lang="ts">
import { type Component, PropType } from 'vue';

type IconButtonSize = 'md' | 'sm';

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  md: 'size-9 rounded-lg hover:bg-inset hover:text-highlight focus-visible:bg-inset focus-visible:text-highlight',
  sm: 'size-5 rounded-sm hover:text-normal focus-visible:text-normal',
};

const props = defineProps({
  icon: {
    type: [Object, Function] as PropType<Component>,
    required: true,
  },
  label: {
    type: String,
    required: true,
  },
  size: {
    type: String as PropType<IconButtonSize>,
    default: 'md',
  },
  tone: {
    type: String as PropType<'muted' | 'strong'>,
    default: 'muted',
  },
  nativeType: {
    type: String as PropType<'button' | 'submit'>,
    default: 'button',
  },
});
</script>
