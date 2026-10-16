<template>
  <ui-multi-select
    v-model:value="pickedValues"
    :options="options"
    :name="props.name"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

import type { UserRoleId } from '@libs/dto';

import { useUserAdminService } from '@/services/api/admin/UserAdminService';

import { type ISelectOption, UiMultiSelect } from '@/components/ui';

import { useResource } from '@/composables/useResource';

const roleIds = defineModel<UserRoleId[]>('value', { default: () => [] });

const props = defineProps({
  name: {
    type: String,
    default: undefined,
  },
  placeholder: {
    type: String,
    default: 'No roles',
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const userAdminService = useUserAdminService();

const { data: roleList } = useResource({
  request: {},
  fetch: () => userAdminService.getRoleList(),
});

// UiMultiSelect takes string values, and role ids are numbers.
const options = computed<ISelectOption<string>[]>(() =>
  (roleList.value ?? []).map(role => ({ value: String(role.id), label: role.name }))
);

const pickedValues = computed({
  get: () => roleIds.value.map(roleId => String(roleId)),
  set: (values: string[]) => {
    roleIds.value = values
      .map(value => roleList.value?.find(role => String(role.id) === value))
      .filter(role => role !== undefined)
      .map(role => role.id);
  },
});
</script>
