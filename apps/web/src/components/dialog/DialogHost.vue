<template>
  <confirm-dialog v-if="dialogStore.top" :key="dialogStore.top.id" :options="dialogStore.top.options" @close="close" />
</template>

<script setup lang="ts">
import { useDialogStore } from '@/stores/dialog';

import ConfirmDialog from './ConfirmDialog.vue';

const dialogStore = useDialogStore();

const close = (confirmed: boolean) => {
  if (dialogStore.top !== null) {
    dialogStore.close(dialogStore.top, confirmed);
  }
};
</script>
