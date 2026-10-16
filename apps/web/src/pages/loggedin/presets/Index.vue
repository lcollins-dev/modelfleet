<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Presets"
      subtitle="Reusable settings for deployments. A preset doesn't name a model or a node."
    >
      <ui-button type="primary" to="/presets/create">
        <template #icon>
          <icon-add class="size-4" />
        </template>
        New Preset
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="backendFilter"
        placeholder="Search presets"
        filter-label="Backend"
        :options="backendOptions"
      />

      <ui-table :columns="TABLE_COLUMNS" :min-width="560">
        <ui-table-head>
          <span>Preset</span>
          <span>Backend</span>
          <span>Used by</span>
          <span></span>
        </ui-table-head>

        <ui-table-row
          v-for="preset of presetList"
          :key="preset.id"
          :to="`/presets/${preset.id}`"
          data-testid="preset-row"
        >
          <div class="min-w-0">
            <div class="truncate font-medium text-header">{{ preset.name }}</div>

            <div class="mt-0.5 truncate text-xs text-muted">{{ preset.description ?? 'No description' }}</div>
          </div>

          <div>
            <ui-tag>{{ preset.backend }}</ui-tag>
          </div>

          <span class="text-xs" :class="preset.deployments === 0 ? 'text-muted' : ''">{{ describeUse(preset) }}</span>

          <icon-chevron-right class="size-4 text-muted" />
        </ui-table-row>

        <template v-if="!loading && presetList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="preset-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded';

import { BackendId } from '@libs/backends';
import type { ListPresetDto, PresetListRequestDto } from '@libs/dto';
import { EventPartyType } from '@libs/dto';

import { formatCount } from '@/utils/format/number';

import { usePresetAdminService } from '@/services/api/admin/PresetAdminService';

import { MfFilterToolbar } from '@/components/mf';
import {
  ISelectOption,
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

import { usePagedList } from '@/composables/usePagedList';

const ANY = 'any';

type BackendFilter = BackendId | typeof ANY;

const TABLE_COLUMNS = 'minmax(0, 1fr) 7.5rem 7.5rem 1rem';

const presetAdminService = usePresetAdminService();

const search = ref('');
const backendFilter = ref<BackendFilter>(ANY);

const backendOptions = computed<ISelectOption<BackendFilter>[]>(() => [
  { value: ANY, label: 'All backends' },
  ...Object.values(BackendId).map(id => ({ value: id, label: id })),
]);

const listRequest = computed<PresetListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  backend: backendFilter.value === ANY ? undefined : [backendFilter.value],
}));

const unfiltered = computed(() => search.value.length === 0 && backendFilter.value === ANY);

const emptyDescription = computed(() =>
  unfiltered.value
    ? 'No presets yet. Create one when several deployments need the same settings.'
    : 'No presets match your search.'
);

const describeUse = (preset: ListPresetDto): string =>
  preset.deployments === 0 ? 'Not used' : formatCount(preset.deployments, 'deployment');

const {
  list: presetList,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    presetAdminService
      .getPresetList(request, listPage)
      .then(response => ({ list: response.presetList, pages: response.pages })),
  liveSubjects: [EventPartyType.PRESET, EventPartyType.DEPLOYMENT],
});

const countLabel = computed(() => `Showing ${formatCount(presetList.value.length, 'preset')}`);
</script>
