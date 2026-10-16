<template>
  <ui-page-container>
    <ui-page-heading v-if="model" back-to="/models" back-label="Models">
      <template #title>
        <span class="break-all font-mono">{{ modelLabel(model) }}</span>
      </template>

      <template #subtitle>{{ metaLine }}</template>

      <div class="flex items-center gap-3">
        <mf-licence-tag :licence="model.licence" />

        <ui-button @click="openEditModal">
          <template #icon>
            <icon-edit class="size-4" />
          </template>
          Edit
        </ui-button>
      </div>
    </ui-page-heading>

    <ui-back-link v-else to="/models" label="Models" />

    <div v-if="loadingModel && !model" class="flex justify-center py-8">
      <ui-spinner />
    </div>

    <ui-card v-else-if="!model">
      <ui-empty>Could not load this model.</ui-empty>
    </ui-card>

    <template v-else>
      <ui-notice v-if="companionName !== null" type="info" title="This file cannot be deployed on its own">
        {{ COMPANION_DESCRIPTION }}
      </ui-notice>

      <ui-notice v-if="model.state === ModelState.UNAVAILABLE" type="warning" title="No online node stores this model">
        {{ unavailableDescription }}
      </ui-notice>

      <ui-card title="Metadata" subtitle="Read from the file header." data-testid="metadata-card">
        <ui-stat-grid>
          <ui-stat v-for="entry of metadata" :key="entry.label" :label="entry.label" mono>
            <ui-link v-if="entry.href" class="break-all" :to="entry.href" external target="_blank">
              {{ entry.value }}
            </ui-link>

            <span v-else class="break-all">{{ entry.value }}</span>
          </ui-stat>
        </ui-stat-grid>
      </ui-card>

      <ui-card
        title="Availability"
        subtitle="Where the weights are, and when each node last confirmed them."
        flush
        data-testid="availability-card"
      >
        <ui-list-row
          v-for="entry of model.availability"
          :key="entry.nodeId"
          :to="`/nodes/${entry.nodeId}`"
          data-testid="availability-row"
        >
          <template #icon>
            <icon-dns class="size-5" />
          </template>

          <template #title>
            <span class="font-mono">{{ entry.nodeName }}</span>
          </template>

          <template #tags>
            <ui-tag :type="nodeStateTone(entry.nodeState)">{{ formatNodeState(entry.nodeState) }}</ui-tag>
          </template>

          <template #meta>
            <span class="break-all font-mono">{{ entry.path }}</span>
          </template>

          <template #actions>
            <span class="whitespace-nowrap text-xs text-muted">
              Confirmed {{ formatRelativeDate(entry.lastConfirmedDate) }}
            </span>
          </template>
        </ui-list-row>

        <ui-empty v-if="model.availability.length === 0">No nodes store this model.</ui-empty>
      </ui-card>

      <mf-danger-card
        label="Delete model"
        :help="DELETE_HELP"
        action-label="Delete Model"
        :loading="loadingDelete"
        @action="confirmDelete"
      />
    </template>

    <ui-modal v-model:show="showEditModal" class="max-w-lg" title="Edit model">
      <ui-form :name="EDIT_FORM" @submit="doUpdateModel">
        <ui-form-field v-slot="{ input }" label="Display name" path="displayName">
          <ui-input
            v-model:value="displayNameField"
            v-bind="input"
            name="model-display-name"
            autocomplete="off"
            :placeholder="model?.name ?? ''"
          />
        </ui-form-field>

        <ui-form-field v-if="companionName === null" v-slot="{ input }" label="Tasks" path="tasks" :help="detectedHelp">
          <ui-multi-select
            v-model:value="tasksField"
            v-bind="input"
            placeholder="None - use the detected tasks"
            :options="TASK_OPTIONS"
          />

          <div v-if="!showsDetected" class="mt-1">
            <ui-button type="text" @click="useDetectedTasks">Use detected</ui-button>
          </div>
        </ui-form-field>

        <div class="flex justify-end gap-2">
          <ui-button @click="showEditModal = false">Cancel</ui-button>

          <ui-button type="primary" native-type="submit" :loading="loadingUpdate">Save</ui-button>
        </div>
      </ui-form>
    </ui-modal>
  </ui-page-container>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import IconDns from '~icons/material-symbols/dns-outline-rounded';
import IconEdit from '~icons/material-symbols/edit-outline-rounded';

import type { ModelDto } from '@libs/dto';
import { ModelState, ModelTask, ModelType } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { formatDateTime, formatRelativeDate } from '@/utils/format/date';
import { formatBytes, formatCount, formatNumber } from '@/utils/format/number';
import {
  companionLabel,
  formatModalities,
  formatModelKind,
  formatModelTask,
  formatModelTasks,
  licenceMark,
  modelLabel,
  sortModelTasks,
} from '@/utils/model';
import { formatNodeState, nodeStateTone } from '@/utils/node';

import { useLogService } from '@/services/LogService';
import { useModelAdminService } from '@/services/api/admin/ModelAdminService';
import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import { MfDangerCard, MfLicenceTag } from '@/components/mf';
import {
  ISelectOption,
  UiBackLink,
  UiButton,
  UiCard,
  UiEmpty,
  UiForm,
  UiFormField,
  UiInput,
  UiLink,
  UiListRow,
  UiModal,
  UiMultiSelect,
  UiNotice,
  UiPageContainer,
  UiPageHeading,
  UiSpinner,
  UiStat,
  UiStatGrid,
  UiTag,
} from '@/components/ui';

interface IMetadataEntry {
  label: string;
  value: string;
  href?: string;
}

const COMPANION_DESCRIPTION = 'It runs alongside a model. Deploy the model it belongs to instead.';

const DELETE_HELP = 'It is removed from the catalogue. Scanning a node that stores it will add it again.';

const EDIT_FORM = 'update-model';

const TASK_OPTIONS: ISelectOption<ModelTask>[] = Object.values(ModelTask).map(task => ({
  value: task,
  label: formatModelTask(task),
}));

const logService = useLogService();
const logger = logService.createLogger('pages/loggedin/models/Model');

const route = useRoute();
const router = useRouter();
const dialogStore = useDialogStore();
const notificationStore = useNotificationStore();
const modelAdminService = useModelAdminService();

const modelId = computed(() => (typeof route.params.modelId === 'string' ? parseInt(route.params.modelId, 10) : null));

const model = ref<ModelDto | null>(null);
const displayNameField = ref('');
const tasksField = ref<ModelTask[]>([]);
const showEditModal = ref(false);

const loadingModel = ref(false);
const loadingUpdate = ref(false);
const loadingDelete = ref(false);

const detectedHelp = computed(() =>
  model.value === null ? undefined : `Detected from the files: ${formatModelTasks(model.value.detectedTasks)}.`
);

/** Left unsent where untouched, so a rename never pins the tasks a later scan would change. */
const tasksChanged = computed(
  () =>
    model.value !== null &&
    companionName.value === null &&
    sortModelTasks(tasksField.value).join() !== sortModelTasks(model.value.tasks).join()
);

const showsDetected = computed(
  () =>
    model.value !== null && sortModelTasks(tasksField.value).join() === sortModelTasks(model.value.detectedTasks).join()
);

const companionName = computed(() => (model.value === null ? null : companionLabel(model.value.type)));

const metaLine = computed(() => {
  if (model.value === null) {
    return '';
  }

  const nodeCount = model.value.availability.length;

  const facts = [
    ...(model.value.displayName === null ? [] : [model.value.name]),
    ...(companionName.value === null ? [] : [companionName.value]),
    formatModelKind(model.value),
    formatBytes(model.value.sizeBytes),
    nodeCount === 0 ? 'not stored on any node' : `stored on ${formatCount(nodeCount, 'node')}`,
  ];

  return facts.join(' · ');
});

const unavailableDescription = computed(() => {
  if (model.value === null || model.value.availability.length === 0) {
    return 'The model is no longer stored on any node, so it cannot be deployed.';
  }

  const nodeNames = model.value.availability.map(entry => entry.nodeName).join(', ');

  return `The model is stored on ${nodeNames}, but none responds. It cannot be deployed until one comes online.`;
});

const metadata = computed<IMetadataEntry[]>(() => {
  if (model.value === null) {
    return [];
  }

  const entries: IMetadataEntry[] = [
    { label: 'Fingerprint', value: model.value.fingerprint },
    { label: 'Format', value: formatModelKind(model.value) },
    ...whatItDoes(model.value),
    licenceEntry(model.value),
    { label: 'Size', value: formatBytes(model.value.sizeBytes) },
  ];

  if (model.value.shardCount > 1) {
    entries.push({ label: 'Shards', value: formatNumber(model.value.shardCount) });
  }

  entries.push(...ggufEntries(), ...safetensorsEntries());

  entries.push({ label: 'First seen', value: formatDateTime(model.value.createdDate) });

  return entries;
});

const whatItDoes = (shown: ModelDto): IMetadataEntry[] => {
  if (shown.type === ModelType.MODEL) {
    if (!shown.tasksAssigned) {
      return [{ label: 'Tasks', value: formatModelTasks(shown.tasks) }];
    }

    return [
      { label: 'Tasks', value: `${formatModelTasks(shown.tasks)} (set by an admin)` },
      { label: 'Detected', value: formatModelTasks(shown.detectedTasks) },
    ];
  }

  if (shown.type !== ModelType.PROJECTOR) {
    return [];
  }

  const modalities = shown.modalities ?? [];

  return [{ label: 'Encoders', value: modalities.length > 0 ? formatModalities(modalities) : 'not reported' }];
};

const licenceEntry = (shown: ModelDto): IMetadataEntry => {
  const licence = shown.licence;

  if (licence === null) {
    return { label: 'Licence', value: 'not reported' };
  }

  const named = licence.name ?? licence.id;
  const terms = licenceMark(licence);
  const value = terms === null ? named : `${named} (${terms.label.toLowerCase()})`;
  const href = licence.link !== null && /^https?:\/\//.test(licence.link) ? licence.link : undefined;

  return { label: 'Licence', value, href };
};

const ggufEntries = (): IMetadataEntry[] => {
  const metadata = model.value?.ggufMetadata;

  if (metadata === null || metadata === undefined) {
    return [];
  }

  return [
    { label: 'Architecture', value: metadata.architecture ?? 'not reported' },
    { label: 'Layers', value: optionalNumber(metadata.layerCount) },
    { label: 'Embedding dimensions', value: optionalNumber(metadata.embeddingLength) },
    { label: 'Attention heads', value: describeHeads(metadata.headCount, metadata.headCountKv) },
    { label: 'Trained context length', value: optionalNumber(metadata.contextLength) },
  ];
};

const safetensorsEntries = (): IMetadataEntry[] => {
  const metadata = model.value?.safetensorsMetadata;

  if (metadata === null || metadata === undefined) {
    return [];
  }

  return [
    { label: 'Architecture', value: metadata.architecture ?? 'not reported' },
    { label: 'Data type', value: metadata.dtype ?? 'not reported' },
    { label: 'Tensors', value: formatNumber(metadata.tensorCount) },
    { label: 'Parameters', value: formatNumber(metadata.parameterCount) },
  ];
};

const optionalNumber = (value: number | null): string => (value === null ? 'not reported' : formatNumber(value));

const describeHeads = (headCount: number | null, headCountKv: number | null): string => {
  if (headCount === null) {
    return 'not reported';
  }

  return headCountKv === null
    ? formatNumber(headCount)
    : `${formatNumber(headCount)} (${formatNumber(headCountKv)} KV)`;
};

const viewModelList = () => {
  router.push('/models').catch((error: unknown) => {
    logger.error({ error }, 'viewModelList(): Failed to navigate to model list');
  });
};

const doGetModel = (): Promise<void> => {
  if (modelId.value === null) {
    return Promise.resolve();
  }

  loadingModel.value = true;

  return modelAdminService
    .getModel(modelId.value)
    .then(modelResponse => {
      model.value = modelResponse;
    })
    .finally(() => {
      loadingModel.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetModel(): Failed to get model');
    });
};

const openEditModal = () => {
  displayNameField.value = model.value?.displayName ?? '';
  tasksField.value = sortModelTasks(model.value?.tasks ?? []);

  showEditModal.value = true;
};

const useDetectedTasks = () => {
  tasksField.value = sortModelTasks(model.value?.detectedTasks ?? []);
};

const doUpdateModel = () => {
  if (model.value === null || loadingUpdate.value) {
    return;
  }

  loadingUpdate.value = true;
  modelAdminService
    .updateModel(
      {
        displayName: displayNameField.value,
        tasks: tasksChanged.value ? tasksField.value : undefined,
      },
      model.value.id,
      EDIT_FORM
    )
    .then(() => doGetModel())
    .then(() => {
      showEditModal.value = false;

      notificationStore.addToast(
        'Model updated',
        `${model.value === null ? 'The model' : modelLabel(model.value)} is saved.`
      );
    })
    .finally(() => {
      loadingUpdate.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doUpdateModel(): Failed to update model');
    });
};

const confirmDelete = () => {
  const target = model.value;

  if (target === null) {
    return;
  }

  void dialogStore.confirm({
    type: DialogType.DANGER,
    title: `Delete ${modelLabel(target)}?`,
    message: DELETE_HELP,
    confirmLabel: 'Delete Model',
    action: () => doDeleteModel(target),
  });
};

const doDeleteModel = (target: ModelDto): Promise<void> => {
  loadingDelete.value = true;

  return modelAdminService
    .deleteModel(target.id)
    .then(() => {
      notificationStore.addToast('Model deleted', `${modelLabel(target)} no longer appears in the catalogue.`);

      viewModelList();
    })
    .finally(() => {
      loadingDelete.value = false;
    });
};

watchEffect(() => {
  void doGetModel();
});
</script>
