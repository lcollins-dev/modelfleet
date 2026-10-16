<template>
  <div ref="root" class="relative flex h-full items-center" @keydown.esc="onEscape">
    <slot name="trigger" :open="open" :toggle="toggle" :panel-id="panelId" />

    <div v-if="open" :id="panelId" class="absolute right-0 top-full z-50 mt-1">
      <slot :close="close" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onClickOutside } from '@vueuse/core';
import { useId, useTemplateRef } from 'vue';

const open = defineModel<boolean>('open', { default: false });

const panelId = useId();

const root = useTemplateRef('root');

const toggle = () => {
  open.value = !open.value;
};

const close = () => {
  open.value = false;
};

const onEscape = (event: KeyboardEvent) => {
  if (!open.value) {
    return;
  }

  event.preventDefault();
  close();

  // The trigger slot renders first, so the first button is the trigger.
  root.value?.querySelector('button')?.focus();
};

onClickOutside(root, close);
</script>
