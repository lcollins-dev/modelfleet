<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Downloads"
      subtitle="Files being put on your nodes. A finished file shows in the model catalogue once the node scans it."
    >
      <ui-button type="primary" to="/downloads/create">
        <template #icon>
          <icon-add class="size-4" />
        </template>
        New Download
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="stateFilter"
        placeholder="Search downloads"
        filter-label="State"
        :options="stateOptions"
      />

      <ui-table :columns="TABLE_COLUMNS" :min-width="600">
        <ui-table-head>
          <span>Download</span>
          <span>State</span>
          <span>Nodes</span>
          <span>Progress</span>
          <span></span>
        </ui-table-head>

        <mf-download-row
          v-for="download of downloadList"
          :key="download.id"
          :download="download"
          :to="`/downloads/${download.id}`"
        />

        <template v-if="!loading && downloadList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="download-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';

import type { DownloadListRequestDto, DownloadProgressDto } from '@libs/dto';
import { DownloadState, EventPartyType } from '@libs/dto';

import { formatDownloadState, withProgress } from '@/utils/download';
import { formatCount } from '@/utils/format/number';

import { ISseSubscription } from '@/services/api/SseService';
import { useDownloadAdminService } from '@/services/api/admin/DownloadAdminService';

import { MfDownloadRow, MfFilterToolbar } from '@/components/mf';
import {
  ISelectOption,
  UiButton,
  UiCard,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiTable,
  UiTableHead,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

const ANY = 'any';

type StateFilter = DownloadState | typeof ANY;

const TABLE_COLUMNS = 'minmax(0, 1fr) 7rem 3.5rem 12rem 1rem';

const STATE_ORDER: DownloadState[] = [
  DownloadState.ACTIVE,
  DownloadState.FAILED,
  DownloadState.STOPPED,
  DownloadState.COMPLETED,
];

const downloadAdminService = useDownloadAdminService();

const progress = ref<Map<string, DownloadProgressDto>>(new Map());
const counts = ref<Record<DownloadState, number> | null>(null);

const search = ref('');
const stateFilter = ref<StateFilter>(ANY);

const progressSubscription = shallowRef<ISseSubscription | null>(null);

const total = computed(() => {
  const known = counts.value;

  return known === null ? null : STATE_ORDER.reduce((sum, state) => sum + known[state], 0);
});

const stateOptions = computed<ISelectOption<StateFilter>[]>(() => [
  { value: ANY, label: 'All downloads' },
  ...STATE_ORDER.map(state => ({
    value: state,
    label: formatDownloadState(state),
    description: counts.value === null ? undefined : formatCount(counts.value[state], 'download'),
  })),
]);

const listRequest = computed<DownloadListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  state: stateFilter.value === ANY ? undefined : stateFilter.value,
}));

const {
  list: listed,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    downloadAdminService.getDownloadList(request, listPage).then(response => {
      counts.value = response.counts;

      return { list: response.downloadList, pages: response.pages };
    }),
  liveSubjects: [EventPartyType.DOWNLOAD],
});

const downloadList = computed(() =>
  listed.value.map(download => withProgress(download, progress.value.get(download.key)))
);

const unfiltered = computed(() => search.value.length === 0 && stateFilter.value === ANY);

const emptyDescription = computed(() => {
  if (search.value.length > 0) {
    return 'No downloads match your search.';
  }

  return unfiltered.value
    ? 'No downloads yet. Start one to put files from a Hugging Face repository on your nodes.'
    : 'No downloads in this view.';
});

const countLabel = computed(() => {
  const shown = downloadList.value.length;

  return total.value === null
    ? `Showing ${formatCount(shown, 'download')}`
    : `Showing ${shown} of ${formatCount(total.value, 'download')}`;
});

onMounted(() => {
  progressSubscription.value = downloadAdminService.streamDownloadProgress(response => {
    progress.value = new Map(response.downloads.map(entry => [entry.key, entry]));
  });
});

onBeforeUnmount(() => {
  progressSubscription.value?.close();
});
</script>
