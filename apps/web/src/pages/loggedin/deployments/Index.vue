<template>
  <ui-page-container wide>
    <ui-page-heading
      title="Deployments"
      subtitle="Named endpoints your apps call. Each one pairs a model with its settings."
    >
      <ui-button type="primary" to="/deployments/create">
        <template #icon>
          <icon-add class="size-4" />
        </template>
        New Deployment
      </ui-button>
    </ui-page-heading>

    <ui-card flush>
      <mf-filter-toolbar v-model:search="search" placeholder="Search name or description" />

      <ui-table :columns="TABLE_COLUMNS" :min-width="720">
        <ui-table-head>
          <span>Deployment</span>
          <span>State</span>
          <span>Activation</span>
          <span>Instances</span>
          <span></span>
        </ui-table-head>

        <mf-deployment-row
          v-for="deployment of deploymentList"
          :key="deployment.id"
          :deployment="deployment"
          :instances="instances"
          :to="`/deployments/${deployment.id}`"
        />

        <template v-if="!loading && deploymentList.length === 0" #empty>{{ emptyDescription }}</template>

        <template #footer>
          <span data-testid="deployment-count">{{ countLabel }}</span>

          <ui-pagination v-if="pages > 1" v-model:page="page" :page-count="pages" />
        </template>
      </ui-table>
    </ui-card>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import IconAdd from '~icons/material-symbols/add-rounded';

import type { DeploymentListRequestDto, ListInstanceDto } from '@libs/dto';
import { EventPartyType } from '@libs/dto';

import { formatCount } from '@/utils/format/number';

import { ISseSubscription } from '@/services/api/SseService';
import { useDeploymentAdminService } from '@/services/api/admin/DeploymentAdminService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';

import { MfDeploymentRow, MfFilterToolbar } from '@/components/mf';
import { UiButton, UiCard, UiPageContainer, UiPageHeading, UiPagination, UiTable, UiTableHead } from '@/components/ui';

import { usePagedList } from '@/composables/usePagedList';

const TABLE_COLUMNS = 'minmax(0, 1fr) 12rem 6.5rem 4.5rem 1rem';

const deploymentAdminService = useDeploymentAdminService();
const instanceAdminService = useInstanceAdminService();

const search = ref('');
const total = ref<number | null>(null);

const instances = shallowRef<ListInstanceDto[]>([]);
const instanceSubscription = shallowRef<ISseSubscription | null>(null);

const listRequest = computed<DeploymentListRequestDto>(() => ({
  search: search.value.length > 0 ? search.value : undefined,
}));

const emptyDescription = computed(() =>
  search.value.length > 0
    ? 'No deployments match your search.'
    : 'No deployments yet. Create one to make a configured model available to callers.'
);

const {
  list: deploymentList,
  page,
  pages,
  loading,
} = usePagedList({
  request: listRequest,
  fetch: (request, listPage) =>
    deploymentAdminService.getDeploymentList(request, listPage).then(response => {
      total.value = response.total;

      return { list: response.deploymentList, pages: response.pages };
    }),
  liveSubjects: [EventPartyType.DEPLOYMENT, EventPartyType.PRESET],
});

const countLabel = computed(() => {
  const shown = deploymentList.value.length;

  return total.value === null
    ? `Showing ${formatCount(shown, 'deployment')}`
    : `Showing ${shown} of ${formatCount(total.value, 'deployment')}`;
});

onMounted(() => {
  instanceSubscription.value = instanceAdminService.streamInstances(response => {
    instances.value = response.instances;
  });
});

onBeforeUnmount(() => {
  instanceSubscription.value?.close();
});
</script>
