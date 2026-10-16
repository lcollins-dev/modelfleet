<template>
  <ui-tag :type="props.userRoleIds.length > 0 ? 'primary' : 'default'" data-testid="user-access">{{ label }}</ui-tag>
</template>

<script setup lang="ts">
import { computed, PropType } from 'vue';

import { UserRoleId } from '@libs/dto';

import { UiTag } from '@/components/ui';

const props = defineProps({
  userRoleIds: {
    type: Array as PropType<number[]>,
    required: true,
  },
});

const label = computed(() => {
  const userAdmin = props.userRoleIds.includes(UserRoleId.USER_ADMIN);
  const systemAdmin = props.userRoleIds.includes(UserRoleId.SYSTEM_ADMIN);

  if (userAdmin && systemAdmin) {
    return 'Admin';
  }

  if (systemAdmin) {
    return 'System admin';
  }

  return userAdmin ? 'User admin' : 'User';
});
</script>
