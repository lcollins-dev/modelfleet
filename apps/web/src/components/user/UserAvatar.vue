<template>
  <ui-avatar :size="props.size" round :type="props.user.enabled ? 'primary' : 'gray'">{{ initial }}</ui-avatar>
</template>

<script setup lang="ts">
import { computed, PropType } from 'vue';

import type { ListUserDto } from '@libs/dto';

import { accountInitial } from '@/utils/accountLabel';

import { type AvatarSize, UiAvatar } from '@/components/ui';

const props = defineProps({
  user: {
    type: Object as PropType<Pick<ListUserDto, 'name' | 'email' | 'enabled'>>,
    required: true,
  },
  size: {
    type: String as PropType<AvatarSize>,
    default: 'md',
  },
});

const initial = computed(() => accountInitial(props.user.name, props.user.email));
</script>
