<template>
  <div class="flex min-w-0 font-mono text-xs" :title="props.path" data-testid="download-file-path">
    <span v-if="folder.length > 0" class="min-w-4 shrink-[9999] truncate text-muted" data-testid="download-file-folder">
      {{ folder }}
    </span>

    <span class="min-w-0 truncate text-highlight" data-testid="download-file-name">{{ name }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps({
  path: {
    type: String,
    required: true,
  },
});

const nameStart = computed(() => props.path.lastIndexOf('/') + 1);

/** Its huge shrink factor gives up its width before the name does, keeping a shard number readable. */
const folder = computed(() => props.path.slice(0, nameStart.value));

const name = computed(() => props.path.slice(nameStart.value));
</script>
