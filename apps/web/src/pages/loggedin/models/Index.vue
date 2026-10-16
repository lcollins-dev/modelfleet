<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Models"
      subtitle="Every model the fleet can serve. Weights held on several nodes are listed once."
    />

    <ui-card flush>
      <mf-filter-toolbar
        v-model:search="search"
        v-model:filter="stateFilter"
        placeholder="Search models"
        :segments="STATE_FILTERS"
      >
        <div class="w-44 shrink-0">
          <ui-select v-model:value="typeFilter" :options="TYPE_OPTIONS" aria-label="Type" />
        </div>

        <div class="w-44 shrink-0">
          <ui-select v-model:value="taskFilter" :options="TASK_OPTIONS" aria-label="Task" />
        </div>
      </mf-filter-toolbar>

      <ui-table :columns="TABLE_COLUMNS" :min-width="600">
        <ui-table-head>
          <span>Model</span>
          <span>Availability</span>
          <span>Nodes</span>
          <span>Size</span>
          <span></span>
        </ui-table-head>

        <mf-model-row v-for="model of modelList" :key="model.id" :model="model" :to="`/models/${model.id}`" />

        <template v-if="!loading && modelList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="model-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ModelListRequestDto } from '@libs/dto';
import { EventPartyType, ModelState, ModelTask, ModelTaskFilter, ModelType, UNKNOWN_MODEL_TASK } from '@libs/dto';

import { formatModelTask, formatModelType } from '@/utils/model';

import { useModelAdminService } from '@/services/api/admin/ModelAdminService';

import { MfFilterToolbar, MfModelRow } from '@/components/mf';
import {
  ISegmentedControlOption,
  ISelectOption,
  UiCard,
  UiPageContainer,
  UiPageHeading,
  UiPagination,
  UiSelect,
  UiTable,
  UiTableHead,
} from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

const ANY = 'any';

type StateFilter = ModelState | typeof ANY;
type TypeFilter = ModelType | typeof ANY;
type TaskFilter = ModelTaskFilter | typeof ANY;

const TABLE_COLUMNS = 'minmax(0, 1fr) 7rem 3.5rem 5.5rem 1rem';

const STATE_FILTERS: ISegmentedControlOption<StateFilter>[] = [
  { value: ANY, label: 'All' },
  { value: ModelState.AVAILABLE, label: 'Available' },
  { value: ModelState.UNAVAILABLE, label: 'Unavailable' },
];

const TYPE_OPTIONS: ISelectOption<TypeFilter>[] = [
  { value: ANY, label: 'All types' },
  ...Object.values(ModelType).map(type => ({ value: type, label: formatModelType(type) })),
];

const TASK_FILTERS: ModelTaskFilter[] = [...Object.values(ModelTask), UNKNOWN_MODEL_TASK];

const TASK_OPTIONS: ISelectOption<TaskFilter>[] = [
  { value: ANY, label: 'All tasks' },
  ...TASK_FILTERS.map(task => ({ value: task, label: formatModelTask(task) })),
];

const modelAdminService = useModelAdminService();

const search = ref('');
const stateFilter = ref<StateFilter>(ANY);
const typeFilter = ref<TypeFilter | null>(ANY);
const taskFilter = ref<TaskFilter | null>(ANY);

const narrowed = <TValue extends string>(value: TValue | typeof ANY | null): TValue[] | undefined =>
  value === ANY || value === null ? undefined : [value];

const listRequest = computed<ModelListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
  state: narrowed(stateFilter.value),
  type: narrowed(typeFilter.value),
  task: narrowed(taskFilter.value),
}));

const filtered = computed(
  () =>
    narrowed(stateFilter.value) !== undefined ||
    narrowed(typeFilter.value) !== undefined ||
    narrowed(taskFilter.value) !== undefined
);

const emptyDescription = computed(() => {
  if (filtered.value) {
    return 'No models in this view.';
  }

  return search.value.length > 0
    ? 'No models match your search.'
    : 'No models found yet. Configure a node with a weights directory, then scan it to add models to the catalogue.';
});

const {
  list: modelList,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    modelAdminService
      .getModelList(request, listPage)
      .then(response => ({ list: response.modelList, pages: response.pages })),
  liveSubjects: [EventPartyType.MODEL],
});

const countLabel = computed(() => {
  const shown = modelList.value.length;

  return `Showing ${shown} ${shown === 1 ? 'model' : 'models'}`;
});
</script>
