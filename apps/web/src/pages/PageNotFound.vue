<template>
  <div class="mx-auto mt-16 max-w-sm">
    <ui-result :icon="IconSearchOff" title="Page not found">
      There's nothing at this address. Check the link, or go back to the overview.

      <template #actions>
        <ui-button type="primary" to="/">Go to Overview</ui-button>
      </template>
    </ui-result>
  </div>
</template>

<script setup lang="ts">
import IconSearchOff from '~icons/material-symbols/search-off-rounded';

import { UiButton, UiResult } from '@/components/ui';
</script>
