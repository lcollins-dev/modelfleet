<template>
  <div class="flex flex-col items-center gap-2.5 px-4 py-8 text-center text-muted">
    <icon-inventory class="size-7" aria-hidden="true" />

    <div><slot /></div>
  </div>
</template>

<script setup lang="ts">
import IconInventory from '~icons/material-symbols/inventory-2-outline-rounded';
</script>
