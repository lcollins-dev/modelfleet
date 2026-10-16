<template>
  <ui-page-container wide>
    <ui-page-heading title="Users" subtitle="Everyone with an account on this fleet.">
      <ui-button type="primary" to="/users/create">
        <template #icon>
          <icon-person-add class="size-4" />
        </template>
        New User
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="status"
        placeholder="Search name or email"
        :segments="STATUS_FILTERS"
      />

      <ui-table :columns="TABLE_COLUMNS" :min-width="560">
        <ui-table-head>
          <span>Account</span>
          <span>Access</span>
          <span></span>
        </ui-table-head>

        <ui-table-row v-for="user of userList" :key="user.id" :to="`/users/${user.id}`" data-testid="user-row">
          <div class="flex min-w-0 items-center gap-3">
            <user-avatar :user="user" />

            <div class="min-w-0">
              <div class="truncate font-medium text-header">{{ user.name }}</div>
              <div class="truncate text-xs text-muted">{{ user.email }}</div>
            </div>
          </div>

          <div class="flex gap-1.5">
            <user-access-tag :user-role-ids="user.userRoleIds" />
            <ui-tag :type="user.enabled ? 'success' : 'error'">{{ user.enabled ? 'Enabled' : 'Disabled' }}</ui-tag>
          </div>

          <icon-chevron-right class="size-4 text-muted" />
        </ui-table-row>

        <template v-if="!loading && userList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="user-count">
            Showing {{ userList.length }}{{ viewTotal === null ? '' : ` of ${viewTotal}` }} accounts
          </span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';
import IconPersonAdd from '~icons/material-symbols/person-add-outline-rounded';

import type { UserListRequestDto, UserStatsResponseDto } from '@libs/dto';
import { UserListStatus } from '@libs/dto';

import { useLogService } from '@/services/LogService';
import { useUserAdminService } from '@/services/api/admin/UserAdminService';

import { MfFilterToolbar } from '@/components/mf';
import {
  ISegmentedControlOption,
  UiButton,
  UiCard,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';
import UserAccessTag from '@/components/user/UserAccessTag.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';

import { usePagedList } from '@/composables/usePagedList';

const TABLE_COLUMNS = 'minmax(0, 1fr) 13rem 1.25rem';

const STATUS_FILTERS: ISegmentedControlOption<UserListStatus>[] = [
  { value: UserListStatus.ALL, label: 'All' },
  { value: UserListStatus.ENABLED, label: 'Enabled' },
  { value: UserListStatus.DISABLED, label: 'Disabled' },
];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/users/Index');

const adminUserService = useUserAdminService();

const stats = ref<UserStatsResponseDto>({ total: 0, enabled: 0, disabled: 0 });

const search = ref('');
const status = ref<UserListStatus>(UserListStatus.ALL);

const listRequest = computed<UserListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  status: status.value,
}));

const viewTotal = computed(() => {
  if (search.value.length > 0) {
    return null;
  }

  if (status.value === UserListStatus.ENABLED) {
    return stats.value.enabled;
  }

  if (status.value === UserListStatus.DISABLED) {
    return stats.value.disabled;
  }

  return stats.value.total;
});

const emptyDescription = computed(() => {
  if (search.value.length > 0) {
    return 'No accounts match your search.';
  }

  if (stats.value.total === 0) {
    return 'No users yet.';
  }

  return 'No accounts in this view.';
});

const doGetStats = () => {
  adminUserService
    .getUserStats()
    .then(statsResponse => {
      stats.value = statsResponse;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetStats(): Failed to get user stats');
    });
};

const {
  list: userList,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    adminUserService
      .getUserList(request, listPage)
      .then(response => ({ list: response.userList, pages: response.pages })),
});

doGetStats();
</script>
