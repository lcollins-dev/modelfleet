<template>
  <ui-select
    :value="selectedOption"
    :options="options"
    :loading="loading"
    :placeholder="props.placeholder"
    searchable
    remote
    clearable
    @search="search"
    @update:value="setOption"
  >
    <template #optionExtra="{ option }">
      <span v-if="tasksOf(option.value).length > 0" class="flex shrink-0 gap-1">
        <ui-tag v-for="task of tasksOf(option.value)" :key="task">{{ formatModelTask(task) }}</ui-tag>
      </span>
    </template>
  </ui-select>
</template>

<script setup lang="ts" generic="TKey extends 'id' | 'fingerprint'">
import { useDebounceFn } from '@vueuse/core';
import { computed, onMounted, ref, watch } from 'vue';

import type { ListModelDto, ModelFormat, ModelTaskFilter } from '@libs/dto';
import { ModelType, UNKNOWN_MODEL_TASK } from '@libs/dto';

import { Config } from '@/Config';

import { formatModelKind, formatModelTask, modelFileName, modelLabel, sortModelTasks } from '@/utils/model';

import { useLogService } from '@/services/LogService';
import { useModelAdminService } from '@/services/api/admin/ModelAdminService';

import { ISelectOption, UiSelect, UiTag } from '@/components/ui';

/** Named apart from its file, which the kit's own `Select` would otherwise share. */
defineOptions({ name: 'MfModelSelect' });

const LIST_PAGE = 1;

const logService = useLogService();
const logger = logService.createLogger('components/mf/ModelSelect');

const modelAdminService = useModelAdminService();

const props = defineProps<{
  modelType: ModelType;

  formats?: ModelFormat[];

  valueKey: TKey;

  placeholder: string;

  fallbackLabel?: string;
}>();

const value = defineModel<ListModelDto[TKey] | null>({ required: true });

const models = ref<ListModelDto[]>([]);
const loading = ref(false);

const chosen = ref<ListModelDto | null>(null);

let typedTerm = '';
let listedTerm = '';

/** Only the latest request's answer is shown, so a slow narrowing search cannot overwrite a newer list. */
let latestRequest = 0;

/** A saved model is only dropped for its format once the formats move, never for the ones it was saved under. */
let formatsChanged = false;

const keyOf = (model: ListModelDto): ListModelDto[TKey] => model[props.valueKey];

const selectedModel = computed<ListModelDto | null>(() => {
  const selected = chosen.value;

  return selected !== null && keyOf(selected) === value.value ? selected : null;
});

const listed = computed<ListModelDto[]>(() => {
  const selected = selectedModel.value;

  if (selected === null) {
    return models.value;
  }

  if (models.value.some(model => keyOf(model) === keyOf(selected))) {
    return models.value;
  }

  return [selected, ...models.value];
});

const describeFile = (model: ListModelDto): string => {
  const fileName = modelFileName(model);
  const kind = formatModelKind(model);

  return fileName === null ? kind : `${fileName} · ${kind}`;
};

const options = computed<ISelectOption<string>[]>(() => {
  const listedOptions = listed.value.map(model => ({
    value: String(keyOf(model)),
    label: modelLabel(model),
    description: describeFile(model),
  }));
  const saved = value.value;

  if (saved === null || listedOptions.some(option => option.value === String(saved))) {
    return listedOptions;
  }

  return [{ value: String(saved), label: props.fallbackLabel ?? String(saved) }, ...listedOptions];
});

const selectedOption = computed(() => (value.value === null ? null : String(value.value)));

const modelFor = (optionValue: string): ListModelDto | undefined =>
  listed.value.find(model => String(keyOf(model)) === optionValue);

const tasksOf = (optionValue: string): ModelTaskFilter[] => {
  const model = modelFor(optionValue);

  if (model === undefined || model.type !== ModelType.MODEL) {
    return [];
  }

  return model.tasks.length === 0 ? [UNKNOWN_MODEL_TASK] : sortModelTasks(model.tasks);
};

const setOption = (next: string | null) => {
  const model = next === null ? undefined : modelFor(next);

  if (model !== undefined) {
    value.value = keyOf(model);
    chosen.value = model;
  } else if (next === null || String(value.value) !== next) {
    value.value = null;
    chosen.value = null;
  }
};

const fetchModels = (term: string): Promise<ListModelDto[]> =>
  modelAdminService
    .getModelList(
      { search: term.length > 0 ? term : undefined, type: [props.modelType], format: props.formats },
      LIST_PAGE
    )
    .then(response => response.modelList);

const fetchPage = (term: string): Promise<void> => {
  latestRequest += 1;

  const request = latestRequest;

  loading.value = true;

  return fetchModels(term)
    .then(found => {
      if (request !== latestRequest) {
        return;
      }

      listedTerm = term;
      models.value = found;
      chosen.value = found.find(model => keyOf(model) === value.value) ?? chosen.value;
    })
    .finally(() => {
      if (request === latestRequest) {
        loading.value = false;
      }
    });
};

const doSearch = (term: string) => {
  fetchPage(term).catch((error: unknown) => {
    logger.error({ error, modelType: props.modelType }, 'doSearch(): Failed to search the model catalogue');
  });
};

const lookUp = (saved: ListModelDto[TKey]): Promise<ListModelDto | undefined> => {
  if (typeof saved === 'number') {
    return modelAdminService.getModel(saved);
  }

  return modelAdminService.findModelByFingerprint(saved, props.modelType);
};

const resolveSaved = (): Promise<void> => {
  const saved = value.value;

  if (saved === null || (chosen.value !== null && keyOf(chosen.value) === saved)) {
    return Promise.resolve();
  }

  return lookUp(saved).then(model => {
    if (model !== undefined && keyOf(model) === value.value) {
      chosen.value = model;
    }

    if (formatsChanged) {
      dropUnloadable();
    }
  });
};

/** The select emits an empty term as it closes, which re-lists the whole first page after a search narrowed it. */
const debouncedSearch = useDebounceFn((term: string) => {
  if (term === typedTerm && (term !== listedTerm || loading.value)) {
    doSearch(term);
  }
}, Config.LIST_DEBOUNCE_MS);

const search = (term: string) => {
  typedTerm = term;
  debouncedSearch(term).catch((error: unknown) => {
    logger.error({ error }, 'search(): Failed to search the model catalogue');
  });
};

const dropUnloadable = () => {
  const formats = props.formats;
  const selected = selectedModel.value;

  if (selected !== null && formats !== undefined && !formats.includes(selected.format)) {
    value.value = null;
    chosen.value = null;
  }
};

watch(
  () => props.formats?.join(),
  () => {
    formatsChanged = true;
    dropUnloadable();
    doSearch('');
  }
);

onMounted(() => {
  fetchPage('')
    .catch((error: unknown) => {
      logger.error({ error, modelType: props.modelType }, 'onMounted(): Failed to list the model catalogue');
    })
    .then(resolveSaved)
    .catch((error: unknown) => {
      logger.error({ error, modelType: props.modelType }, 'onMounted(): Failed to look the saved model up');
    });
});
</script>
