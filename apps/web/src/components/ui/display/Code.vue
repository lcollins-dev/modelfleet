<template>
  <pre
    v-if="props.block"
    class="m-0 whitespace-pre-wrap wrap-anywhere bg-inset px-4 py-3 font-mono text-xs leading-relaxed shadow-[inset_0_2px_4px_rgb(0_0_0/0.12)]"
    :class="props.tone === 'error' ? 'text-error' : 'text-highlight'"
  ><slot /></pre>

  <code v-else :class="[CODE_CLASS, props.emphasis ? 'bg-emphasis' : 'bg-inset']"><slot /></code>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

const CODE_CLASS = 'break-all rounded-md px-1 py-px font-mono text-xs text-highlight';

const props = defineProps({
  emphasis: {
    type: Boolean,
    default: false,
  },
  block: {
    type: Boolean,
    default: false,
  },
  tone: {
    type: String as PropType<'default' | 'error'>,
    default: 'default',
  },
});
</script>
