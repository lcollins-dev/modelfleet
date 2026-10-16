<template>
  <mf-model-select
    v-model="value"
    :model-type="props.modelType"
    value-key="fingerprint"
    :placeholder="shownPlaceholder"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ListModelDto } from '@libs/dto';
import { ModelType } from '@libs/dto';

import { modelLabel } from '@/utils/model';

import { useLogService } from '@/services/LogService';
import { useModelAdminService } from '@/services/api/admin/ModelAdminService';

import MfModelSelect from '@/components/mf/model/Select.vue';

const logService = useLogService();
const logger = logService.createLogger('components/mf/ConfigurationModelReference');

const modelAdminService = useModelAdminService();

const props = defineProps<{
  modelType: ModelType;

  placeholder: string;

  /** The fingerprint a preset sets, named in the placeholder rather than shown as a digest. */
  inherited?: string | null;
}>();

const value = defineModel<string | null>({ required: true });

const inheritedModel = ref<ListModelDto | null>(null);

const shownPlaceholder = computed(() => {
  const model = inheritedModel.value;

  return model === null ? props.placeholder : `Inherited: ${modelLabel(model)}`;
});

const doGetInherited = (fingerprint: string) => {
  modelAdminService
    .findModelByFingerprint(fingerprint, props.modelType)
    .then(model => {
      if (props.inherited === fingerprint) {
        inheritedModel.value = model ?? null;
      }
    })
    .catch((error: unknown) => {
      logger.error({ error, fingerprint }, 'doGetInherited(): Failed to look up the inherited model');
    });
};

/** A preset can be chosen or swapped while the field stays mounted, so the inherited projector is followed. */
watch(
  () => props.inherited,
  inherited => {
    inheritedModel.value = null;

    if (inherited !== null && inherited !== undefined) {
      doGetInherited(inherited);
    }
  },
  { immediate: true }
);
</script>
