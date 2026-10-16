<template>
  <!-- Each [&+&] utility matches a section that follows another, since every section carries the same classes. -->
  <section class="[&+&]:mt-2 [&+&]:border-t [&+&]:border-divider [&+&]:pt-6">
    <h3 v-if="props.title" class="m-0 text-base font-semibold text-header">{{ props.title }}</h3>

    <p v-if="props.subtitle || $slots.subtitle" class="mb-4 mt-0.5 text-xs leading-snug text-muted">
      <slot name="subtitle">{{ props.subtitle }}</slot>
    </p>

    <slot />
  </section>
</template>

<script setup lang="ts">
const props = defineProps({
  title: {
    type: String,
    default: undefined,
  },
  subtitle: {
    type: String,
    default: undefined,
  },
});
</script>
