<template>
  <form novalidate @submit.prevent="emit('submit')">
    <slot />
  </form>
</template>

<script setup lang="ts">
import { PropType, provide, reactive, toRef } from 'vue';

import { FORM_CONTEXT_KEY, FieldAlign, FieldLayout } from './formContext';

// Pass the same name as the `form` of the request this form sends.
const props = defineProps({
  name: {
    type: String as PropType<string | null>,
    default: null,
  },
  layout: {
    type: String as PropType<FieldLayout>,
    default: undefined,
  },
  align: {
    type: String as PropType<FieldAlign>,
    default: undefined,
  },
});

const emit = defineEmits<{
  submit: [];
}>();

provide(
  FORM_CONTEXT_KEY,
  reactive({
    name: toRef(props, 'name'),
    layout: toRef(props, 'layout'),
    align: toRef(props, 'align'),
  })
);
</script>
