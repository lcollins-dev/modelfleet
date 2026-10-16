<template>
  <nav class="flex items-center gap-1" aria-label="Pagination">
    <ui-button square aria-label="Previous page" :disabled="page <= 1" @click="page = page - 1">
      <icon-chevron-left class="size-4" />
    </ui-button>

    <div class="flex items-center gap-1">
      <template v-for="(slot, index) of slots" :key="index">
        <span v-if="slot === null" class="flex size-8 items-center justify-center text-muted">…</span>

        <ui-button
          v-else
          :type="slot === page ? 'primary' : 'text'"
          :aria-label="`Page ${slot}`"
          :aria-current="slot === page ? 'page' : undefined"
          @click="page = slot"
        >
          {{ slot }}
        </ui-button>
      </template>
    </div>

    <ui-button square aria-label="Next page" :disabled="page >= props.pageCount" @click="page = page + 1">
      <icon-chevron-right class="size-4" />
    </ui-button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import IconChevronLeft from '~icons/material-symbols/chevron-left-rounded';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import UiButton from '../action/Button.vue';
import { paginationSlots } from './paginationSlots';

const page = defineModel<number>('page', { required: true });

const props = defineProps({
  pageCount: {
    type: Number,
    required: true,
  },
});

const slots = computed(() => paginationSlots(page.value, props.pageCount));
</script>
