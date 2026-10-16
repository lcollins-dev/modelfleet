<template>
  <ui-card title="Settings" :subtitle="subtitle" flush data-testid="configuration-editor">
    <template #header-extra>
      <ui-segmented-control :value="view" :options="viewOptions" @update:value="setView" />
    </template>

    <template v-if="view === ConfigurationView.FORM">
      <div v-if="own === null" class="px-6 py-5">
        <ui-notice type="error" title="This document contains invalid YAML">
          Your text is still available in the YAML view. Correct the YAML to restore the form.
        </ui-notice>
      </div>

      <mf-configuration-fields
        v-else
        v-model="fieldValues"
        :declaration="declaration"
        :inherited="inherited"
        :inheriting="hasPreset"
        :lead="DEPLOYMENT_LEAD"
        @submit="emit('submit')"
      >
        <template #default="{ fields, values: leadValues, setField: setLeadField, inherited: inheritedFor }">
          <mf-configuration-field
            v-if="fields[IMAGE_FIELD]"
            :field="fields[IMAGE_FIELD]"
            :inherited="inheritedFor(IMAGE_FIELD)"
            :default-text="imageDefault"
            :model-value="leadValues[IMAGE_FIELD] ?? null"
            @update:model-value="setLeadField(IMAGE_FIELD, $event)"
          />

          <ui-form-field
            v-slot="{ input }"
            path="replicas"
            label="Replicas"
            help="Set the instances kept on each selected node. Existing instances do not restart when this changes."
          >
            <ui-number-input
              v-bind="input"
              :value="replicasValue"
              :min="1"
              :precision="0"
              :placeholder="replicasPlaceholder"
              clearable
              @update:value="setReplicas"
            />
          </ui-form-field>

          <ui-form-field
            v-slot="{ input }"
            path="activationPolicy"
            label="Activation policy"
            :help="describeActivationPolicy(activationPolicy)"
          >
            <ui-select
              v-bind="input"
              :value="activationPolicy"
              :options="activationOptions"
              @update:value="setActivationPolicy"
            />
          </ui-form-field>

          <ui-form-field
            v-if="activationPolicy === ActivationPolicy.ON_DEMAND"
            v-slot="{ input }"
            path="idleTimeout"
            label="Idle timeout"
            help="Choose when to stop an unused deployment. The minimum is 1 minute, for example 30m."
          >
            <ui-input
              v-bind="input"
              :value="idleTimeoutValue ?? ''"
              class="font-mono"
              :placeholder="idleTimeoutPlaceholder"
              clearable
              @update:value="setIdleTimeout"
            />
          </ui-form-field>

          <ui-form-field
            v-slot="{ input }"
            path="vramGib"
            label="Declared VRAM (GiB)"
            help="Set what this deployment takes across its GPUs. It is used in place of a measured figure or an estimate."
          >
            <ui-number-input
              v-bind="input"
              :value="declaredVramValue"
              :min="0.1"
              :max="4096"
              :step="0.5"
              :placeholder="declaredVramPlaceholder"
              clearable
              @update:value="setDeclaredVram"
            />
          </ui-form-field>

          <mf-placement-field
            :model-value="placement"
            :document="document"
            :model-id="props.modelId"
            :preset-id="props.presetId"
            :backend="ownBackend"
            :activation-policy="activationPolicy"
            :deployment-id="props.deploymentId"
            @update:model-value="setPlacement"
          />
        </template>
      </mf-configuration-fields>
    </template>

    <div v-else-if="view === ConfigurationView.YAML" class="px-6 py-5">
      <ui-textarea
        :value="document"
        :rows="24"
        code
        aria-label="Deployment YAML"
        placeholder="# Settings for this deployment. Missing settings are inherited."
        @update:value="setDocument"
      />
    </div>

    <mf-effective-configuration
      v-else-if="effective !== null"
      :configuration="effective"
      :placement-nodes="placementNodes"
    />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </ui-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import IconRocketLaunch from '~icons/material-symbols/rocket-launch-outline-rounded';

import type { BackendId } from '@libs/backends';
import { declarationFor, definitionFor, IMAGE_FIELD } from '@libs/backends';
import type { ConfigurationDocument, DeploymentConfigurationDto, PlacementNodeDto } from '@libs/dto';
import { ActivationPolicy } from '@libs/dto';

import {
  ConfigurationFormValues,
  describeConfigurationValue,
  describeImageDefault,
  holdsKey,
  readFieldValues,
  writeFieldValues,
} from '@/utils/configuration/fields';
import type { IPlacementSelection } from '@/utils/configuration/placement';
import { readPlacement, writePlacement } from '@/utils/configuration/placement';
import { describeActivationPolicy, formatActivationPolicy } from '@/utils/deployment';
import { DocumentEdits, applyToDocument, readDocument } from '@/utils/yaml';

import {
  ISegmentedControlOption,
  ISelectOption,
  UiCard,
  UiFormField,
  UiInput,
  UiNotice,
  UiNumberInput,
  UiSegmentedControl,
  UiSelect,
  UiTextarea,
} from '@/components/ui';

import MfEffectiveConfiguration from './Effective.vue';
import MfConfigurationField from './Field.vue';
import MfConfigurationFields, { IConfigurationLead } from './Fields.vue';
import MfPlacementField from './Placement.vue';

enum ConfigurationView {
  FORM = 'form',
  YAML = 'yaml',
  APPLIED = 'applied',
}

const DEPLOYMENT_LEAD: IConfigurationLead = {
  label: 'Deployment',
  icon: IconRocketLaunch,
  description: 'Choose the container image, number of instances and placement.',
  keys: [IMAGE_FIELD, 'replicas', 'activationPolicy', 'idleTimeout', 'vramGib', 'placement'],
  fields: [IMAGE_FIELD],
};

const REPLICAS_KEY = 'replicas';
const IDLE_TIMEOUT_KEY = 'idleTimeout';
const DECLARED_VRAM_KEY = 'vramGib';
const PLACEMENT_KEY = 'placement';

const activationOptions: ISelectOption<ActivationPolicy>[] = Object.values(ActivationPolicy).map(policy => ({
  label: formatActivationPolicy(policy),
  value: policy,
}));

const props = withDefaults(
  defineProps<{
    /** Null until a preset or a backend names one, which leaves only the deployment's own fields. */
    backend: BackendId | null;

    hasPreset: boolean;

    modelId: number | null;
    presetId: number | null;

    /** Empty where the deployment holds its whole configuration. */
    inherited?: ConfigurationDocument;

    presetName?: string | null;

    /** As saved, not as edited. Absent before the deployment exists. */
    effective?: DeploymentConfigurationDto | null;

    placementNodes?: PlacementNodeDto[];

    deploymentId?: number | null;
  }>(),
  { inherited: () => ({}), presetName: null, effective: null, placementNodes: () => [], deploymentId: null }
);

const emit = defineEmits<{ submit: [] }>();

const document = defineModel<string>({ required: true });
const activationPolicy = defineModel<ActivationPolicy>('activationPolicy', { required: true });

const view = ref<ConfigurationView>(ConfigurationView.FORM);

const viewOptions = computed<ISegmentedControlOption<ConfigurationView>[]>(() => [
  { value: ConfigurationView.FORM, label: 'Form' },
  { value: ConfigurationView.YAML, label: 'YAML' },
  ...(props.effective === null ? [] : [{ value: ConfigurationView.APPLIED, label: 'Applied' }]),
]);

/** Null under a preset, as the API refuses a preset and a backend together. */
const ownBackend = computed(() => (props.hasPreset ? null : props.backend));

const declaration = computed(() => (props.backend === null ? null : declarationFor(props.backend)));

const imageDefault = computed(() =>
  props.backend === null ? undefined : describeImageDefault(definitionFor(props.backend).images)
);

const own = computed(() => readDocument(document.value));

const subtitle = computed(() => {
  if (view.value === ConfigurationView.YAML) {
    return 'Edit settings for this deployment. Saving preserves comments and key order.';
  }

  if (view.value === ConfigurationView.APPLIED) {
    return 'View each saved value and where it was set.';
  }

  if (props.presetName !== null) {
    return `Unset fields inherit their values from ${props.presetName}.`;
  }

  return declaration.value === null
    ? 'Choose a preset or backend to configure its settings.'
    : 'Configure the settings held by this deployment.';
});

const replicasValue = computed(() => {
  const replicas = own.value?.[REPLICAS_KEY];

  return typeof replicas === 'number' ? replicas : null;
});

const placement = computed(() => readPlacement(own.value ?? {}));

const replicasPlaceholder = computed(() => describeInherited(REPLICAS_KEY, 'Default: 1'));

const idleTimeoutValue = computed(() => {
  const idleTimeout = own.value?.[IDLE_TIMEOUT_KEY];

  return typeof idleTimeout === 'string' ? idleTimeout : null;
});

const idleTimeoutPlaceholder = computed(() => describeInherited(IDLE_TIMEOUT_KEY, "Default: the fleet's own timeout"));

const declaredVramValue = computed(() => {
  const declared = own.value?.[DECLARED_VRAM_KEY];

  return typeof declared === 'number' ? declared : null;
});

const declaredVramPlaceholder = computed(() => describeInherited(DECLARED_VRAM_KEY, 'Default: estimated'));

const fieldValues = computed<ConfigurationFormValues>({
  get: () => (declaration.value === null ? {} : readFieldValues(declaration.value.fields, own.value ?? {})),
  set: next => {
    if (declaration.value !== null) {
      applyEdits(writeFieldValues(declaration.value.fields, next));
    }
  },
});

const describeInherited = (key: string, fallback: string): string =>
  holdsKey(props.inherited, key) ? `Inherited: ${describeConfigurationValue(props.inherited[key])}` : fallback;

const applyEdits = (edits: DocumentEdits) => {
  document.value = applyToDocument(document.value, edits);
};

const setDocument = (next: string) => {
  document.value = next;
};

const setView = (next: ConfigurationView) => {
  view.value = next;
};

const setActivationPolicy = (next: ActivationPolicy | null) => {
  if (next !== null) {
    activationPolicy.value = next;
  }
};

const setReplicas = (next: number | null) => {
  applyEdits({ [REPLICAS_KEY]: next ?? undefined });
};

const setIdleTimeout = (next: string) => {
  applyEdits({ [IDLE_TIMEOUT_KEY]: next.trim().length === 0 ? undefined : next.trim() });
};

const setDeclaredVram = (next: number | null) => {
  applyEdits({ [DECLARED_VRAM_KEY]: next ?? undefined });
};

const setPlacement = (next: IPlacementSelection) => {
  applyEdits({ [PLACEMENT_KEY]: writePlacement(own.value ?? {}, next) });
};
</script>
