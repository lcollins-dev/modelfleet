<template>
  <transition-group
    tag="div"
    class="flex flex-col items-center gap-2"
    enter-active-class="transition-all duration-200 ease-out motion-reduce:transition-none"
    leave-active-class="transition-all duration-200 ease-in motion-reduce:transition-none"
    enter-from-class="translate-y-2 scale-95 opacity-0"
    leave-to-class="translate-y-2 scale-95 opacity-0"
  >
    <button
      v-for="toast of toastStore.toasts"
      :key="toast.id"
      type="button"
      class="pointer-events-auto flex max-w-2xl items-center gap-2.5 rounded-full border border-divider bg-popover py-2 pl-2.5 pr-4 text-left text-sm text-normal shadow-[0_4px_16px_var(--overlay)]"
      data-testid="toast"
      @click="toastStore.clearToast(toast.id)"
    >
      <ui-disc-icon :icon="IconCheck" :size="18" class="shrink-0 bg-success text-popover" />

      <span class="line-clamp-2 min-w-0 break-words">
        <span class="font-semibold text-header">{{ toast.title }}.</span>
        {{ toast.content }}
      </span>
    </button>
  </transition-group>
</template>

<script setup lang="ts">
import IconCheck from '~icons/material-symbols/check-rounded';

import { useToastStore } from '@/stores/toast';

import { UiDiscIcon } from '@/components/ui';

const toastStore = useToastStore();
</script>
