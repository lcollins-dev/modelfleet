<template>
  <span>
    <span v-for="(segment, index) of props.segments" :key="index" :class="classesOf(segment.style)">{{
      segment.text
    }}</span>
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';

import { AnsiTone, IAnsiSegment, IAnsiStyle } from '@/utils/ansi';

const TONE_CLASSES: Record<AnsiTone, string> = {
  black: 'text-muted',
  red: 'text-error',
  green: 'text-success',
  yellow: 'text-warning',
  blue: 'text-series-1',
  magenta: 'text-series-7',
  cyan: 'text-accent',
  white: 'text-header',
};

const props = defineProps({
  segments: {
    type: Array as PropType<IAnsiSegment[]>,
    required: true,
  },
});

const classesOf = (style: IAnsiStyle) => [
  style.tone === null ? undefined : TONE_CLASSES[style.tone],
  {
    'font-semibold': style.bold,
    'opacity-70': style.dim,
    italic: style.italic,
    underline: style.underline,
  },
];
</script>
