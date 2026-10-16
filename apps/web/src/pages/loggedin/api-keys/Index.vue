<template>
  <ui-page-container wide>
    <ui-page-heading title="API keys" subtitle="Keys for calling the fleet from any OpenAI-compatible client.">
      <ui-button type="primary" to="/api-keys/create">
        <template #icon>
          <icon-add class="size-4" />
        </template>
        New Key
      </ui-button>
    </ui-page-heading>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))] gap-4">
      <mf-kpi-tile
        label="Active keys"
        :icon="IconKey"
        :value="stats.active"
        :unit="`of ${stats.total}`"
        :bands="stateBands"
        :legend="stateLegend"
        data-testid="active-keys"
      />
    </div>

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="statusFilter"
        placeholder="Search keys"
        :segments="STATUS_FILTERS"
      />

      <ui-table :columns="TABLE_COLUMNS" :min-width="760">
        <ui-table-head>
          <span>Key</span>
          <span>State</span>
          <span>Owner</span>
          <span>Last used</span>
          <span>Created</span>
          <span></span>
        </ui-table-head>

        <ui-table-row v-for="apiKey of apiKeyList" :key="apiKey.id" data-testid="api-key-row">
          <div class="min-w-0">
            <div class="truncate font-medium text-header">{{ apiKey.name }}</div>
            <div class="mt-0.5 truncate font-mono text-xs text-muted">mfk_{{ apiKey.keyId }}</div>
          </div>

          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ui-tag v-if="apiKey.revokedDate === null" type="success">Active</ui-tag>

            <template v-else>
              <ui-tag type="error">Revoked</ui-tag>

              <span class="text-xs text-muted">{{ formatDate(apiKey.revokedDate) }}</span>
            </template>
          </div>

          <div class="min-w-0 truncate text-xs">
            <ui-link
              v-if="apiKey.ownerName !== undefined && canOpenUsers"
              :to="`/users/${apiKey.ownerId}`"
              class="max-w-full"
              data-testid="api-key-owner-link"
            >
              <span class="truncate">{{ apiKey.ownerName }}</span>
            </ui-link>

            <template v-else>{{ apiKey.ownerName ?? 'Deleted user' }}</template>
          </div>

          <span class="text-xs">{{
            apiKey.lastUsedDate === null ? 'Never' : formatRelativeDate(apiKey.lastUsedDate)
          }}</span>

          <span class="text-xs">{{ formatDate(apiKey.createdDate) }}</span>

          <div class="flex justify-end">
            <ui-button
              v-if="apiKey.revokedDate === null"
              type="danger-outline"
              :loading="revokingId === apiKey.id"
              @click="confirmRevoke(apiKey)"
            >
              Revoke
            </ui-button>
          </div>
        </ui-table-row>

        <template v-if="!loading && apiKeyList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="api-key-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconKey from '~icons/material-symbols/key-outline-rounded';

import type { ApiKeyListRequestDto, ApiKeyStatsResponseDto, ListApiKeyDto } from '@libs/dto';
import { ApiKeyListStatus, EventPartyType, UserRoleId } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { formatDate, formatRelativeDate } from '@/utils/format/date';

import { useLogService } from '@/services/LogService';
import { useApiKeyAdminService } from '@/services/api/admin/ApiKeyAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import { IKpiBand, IKpiLegendItem, MfFilterToolbar, MfKpiTile } from '@/components/mf';
import {
  ISegmentedControlOption,
  UiButton,
  UiCard,
  UiLink,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiTable,
  UiTableHead,
  UiTableRow,
  UiTag,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

const TABLE_COLUMNS = 'minmax(0, 1fr) 11rem 9rem 6.5rem 6.5rem 5.5rem';

const STATUS_FILTERS: ISegmentedControlOption<ApiKeyListStatus>[] = [
  { value: ApiKeyListStatus.ANY, label: 'All' },
  { value: ApiKeyListStatus.ACTIVE, label: 'Active' },
  { value: ApiKeyListStatus.REVOKED, label: 'Revoked' },
];

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/api-keys/Index');

const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const userStore = useUserStore();

const apiKeyAdminService = useApiKeyAdminService();

const stats = ref<ApiKeyStatsResponseDto>({ total: 0, active: 0, revoked: 0 });
const statsLoaded = ref(false);

const search = ref('');
const statusFilter = ref<ApiKeyListStatus>(ApiKeyListStatus.ANY);

const revokingId = ref<number | null>(null);

const canOpenUsers = computed(() => userStore.hasRole(UserRoleId.USER_ADMIN));

const listRequest = computed<ApiKeyListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  status: statusFilter.value === ApiKeyListStatus.ANY ? undefined : statusFilter.value,
}));

const unfiltered = computed(() => search.value.length === 0 && statusFilter.value === ApiKeyListStatus.ANY);

const emptyDescription = computed(() => {
  if (search.value.length > 0) {
    return 'No keys match your search.';
  }

  return unfiltered.value
    ? 'No API keys yet. Create one to let an application call the fleet.'
    : 'No keys in this view.';
});

const stateBands = computed<IKpiBand[]>(() => [
  { tone: 'success', percent: stats.value.active },
  { tone: 'error', percent: stats.value.revoked },
]);

const stateLegend = computed<IKpiLegendItem[]>(() => [
  { label: `${stats.value.active} active`, tone: 'success' },
  { label: `${stats.value.revoked} revoked`, tone: 'error' },
]);

const doGetStats = () => {
  apiKeyAdminService
    .getApiKeyStats()
    .then(statsResponse => {
      stats.value = statsResponse;
      statsLoaded.value = true;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetStats(): Failed to get API key stats');
    });
};

const {
  list: apiKeyList,
  page,
  pages,
  loading,
  load,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    apiKeyAdminService
      .getApiKeyList(request, listPage)
      .then(response => ({ list: response.apiKeyList, pages: response.pages })),
  liveSubjects: [EventPartyType.API_KEY],
  onLive: doGetStats,
});

const countLabel = computed(() => {
  const shown = apiKeyList.value.length;

  return statsLoaded.value ? `Showing ${shown} of ${stats.value.total} keys` : `Showing ${shown} keys`;
});

const doRevoke = (apiKey: ListApiKeyDto): Promise<void> => {
  revokingId.value = apiKey.id;

  return apiKeyAdminService
    .revokeApiKey(apiKey.id)
    .then(() => {
      notificationStore.addToast('Key revoked', `${apiKey.name} no longer works.`);

      void load();
      doGetStats();
    })
    .finally(() => {
      revokingId.value = null;
    });
};

const confirmRevoke = (apiKey: ListApiKeyDto) => {
  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Revoke ${apiKey.name}?`,
    message: "Apps using this key stop working straight away. You can't undo this, but the key stays listed.",
    confirmLabel: 'Revoke Key',
    action: () => doRevoke(apiKey),
  });
};

onMounted(() => {
  doGetStats();
});
</script>
