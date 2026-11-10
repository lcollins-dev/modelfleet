<template>
  <span
    class="inline-flex h-5 items-center whitespace-nowrap rounded-full border px-2 text-xs leading-3"
    :class="[TAG_TYPE_CLASSES[props.type], { [HINT_TARGET_CLASSES]: props.hint !== undefined }]"
    :title="props.hint"
  >
    <slot />

    <icon-info v-if="props.hint !== undefined" class="-mr-0.5 ml-1 size-3.5 shrink-0" data-testid="tag-hint-icon" />
  </span>
</template>

<script setup lang="ts">
import { PropType } from 'vue';
import IconInfo from '~icons/material-symbols/info-outline-rounded';

import { HINT_TARGET_CLASSES } from './hint';
import { TAG_TYPE_CLASSES, TagType } from './tag';

const props = defineProps({
  type: {
    type: String as PropType<TagType>,
    default: 'default',
  },
  hint: {
    type: String,
    default: undefined,
  },
});
</script>
