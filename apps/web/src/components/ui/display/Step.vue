<template>
  <div class="flex gap-4 border-t border-divider px-6 py-5 first:border-t-0">
    <!-- Numbered by a CSS counter on UiSteps, so a step shown conditionally renumbers the ones after it. -->
    <span
      class="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-emphasis text-xs font-semibold text-highlight [counter-increment:step] before:content-[counter(step)]"
    />

    <div class="min-w-0 flex-1">
      <div class="mb-1 text-sm font-semibold text-header">{{ props.title }}</div>
      <div class="leading-normal">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
});
</script>
