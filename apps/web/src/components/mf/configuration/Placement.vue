<template>
  <ui-form-field v-slot="{ input }" path="placement" label="Placement" :help="helper">
    <div>
      <ui-segmented-control
        v-bind="input"
        aria-label="Placement"
        :value="mode"
        :options="options"
        @update:value="setMode"
      />
    </div>

    <template v-if="mode === PlacementMode.PIN">
      <ui-picker-frame
        class="mt-3"
        label="Nodes"
        :loading="loadingNodes"
        :empty="nodes.length === 0 ? 'No nodes are available for placement yet.' : ''"
        data-testid="placement-nodes"
      >
        <mf-placement-node
          v-for="node of nodes"
          :key="node.id"
          v-model="selection"
          :node="node"
          :verdict="verdictOf(node.id)"
          :rules="rules"
        />

        <template v-if="previewNote !== null" #footer>
          <span :class="previewNote.warning ? 'text-warning' : 'text-muted'" data-testid="placement-preview-note">
            {{ previewNote.text }}
          </span>
        </template>
      </ui-picker-frame>

      <div class="mt-2 text-pretty text-xs leading-snug text-muted">{{ pinNote }}</div>
    </template>
  </ui-form-field>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core';
import { computed, onMounted, ref, watch } from 'vue';

import type { BackendId } from '@libs/backends';
import { definitionFor } from '@libs/backends';
import type { InstancePlacementDto, ListNodeDto, PlacementNodeDto, PlacementPreviewRequestDto } from '@libs/dto';
import { ActivationPolicy } from '@libs/dto';

import { Config } from '@/Config';

import type { IPinRules, IPinnableNode, IPlacementSelection } from '@/utils/configuration/placement';
import { ANY_PINS, PlacementMode, isAnythingPinnedOn, placementModeOf } from '@/utils/configuration/placement';

import { useLogService } from '@/services/LogService';
import { useInstanceAdminService } from '@/services/api/admin/InstanceAdminService';
import { useNodeAdminService } from '@/services/api/admin/NodeAdminService';
import { useTelemetryAdminService } from '@/services/api/admin/TelemetryAdminService';

import { ISegmentedControlOption, UiFormField, UiPickerFrame, UiSegmentedControl } from '@/components/ui';

import MfPlacementNode from './PlacementNode.vue';

interface IPreviewNote {
  text: string;
  warning: boolean;
}

const NODE_PAGE = 1;

const NO_MODEL_NOTE = 'Choose a model to see whether this selection fits.';
const PREVIEWING_NOTE = 'Checking whether this selection fits.';
const PREVIEW_FAILED_NOTE = 'Whether this selection fits could not be checked.';

const logService = useLogService();
const logger = logService.createLogger('components/mf/PlacementField');

const instanceAdminService = useInstanceAdminService();
const nodeAdminService = useNodeAdminService();
const telemetryAdminService = useTelemetryAdminService();

const props = withDefaults(
  defineProps<{
    document: string;

    modelId: number | null;

    presetId: number | null;
    backend: BackendId | null;
    activationPolicy: ActivationPolicy;

    deploymentId?: number | null;
  }>(),
  { deploymentId: null }
);

const selection = defineModel<IPlacementSelection>({ required: true });

const rules = computed<IPinRules>(() => {
  if (props.backend === null) {
    return ANY_PINS;
  }

  const container = definitionFor(props.backend).container;

  return { multiDevice: container.multiDevice, cpuOffload: container.cpuOffload };
});

const pinChoices = computed(() => {
  if (!rules.value.cpuOffload) {
    return rules.value.multiDevice ? "a node's CPU or one or more of its GPUs" : "a node's CPU or one of its GPUs";
  }

  return rules.value.multiDevice ? "a node's CPU, one or more of its GPUs, or both" : "a node's CPU, one GPU, or both";
});

const options: ISegmentedControlOption<PlacementMode>[] = [
  { value: PlacementMode.AUTOMATIC, label: 'Automatic' },
  { value: PlacementMode.PIN, label: 'Pick devices' },
];

const pinNote = computed(() => {
  const offload = rules.value.cpuOffload
    ? " Tick the CPU as well to let the host's memory take what the GPUs cannot."
    : ' This backend cannot use host memory beside a GPU, so ticking one clears the other.';

  return (
    'Each node selected runs one instance on everything ticked on it. GPUs alone hold the whole model, and the ' +
    `deployment stays pending if they have not the memory for it.${offload} A selection that does not fit can ` +
    'still be saved.'
  );
});

const nodes = ref<IPinnableNode[]>([]);
const loadingNodes = ref(false);

/**
 * Held here rather than read from the selection, since a mode the operator has picked but not filled in yet names
 * no placement and would otherwise read back as automatic the moment it was chosen.
 */
const mode = ref(placementModeOf(selection.value));

const helper = computed(() =>
  mode.value === PlacementMode.PIN
    ? `Run only on the selected hardware. Choose ${pinChoices.value}.`
    : 'Let the scheduler choose devices with enough capacity. It replaces a replica if one fails.'
);

const preview = ref<InstancePlacementDto | null>(null);
const previewing = ref(false);
const previewFailed = ref(false);

/** Counts each preview asked for, so an answer overtaken by a later edit is dropped rather than shown. */
const previewCount = ref(0);

const previewRequest = computed<PlacementPreviewRequestDto | null>(() => {
  if (props.modelId === null || placementModeOf(selection.value) !== PlacementMode.PIN) {
    return null;
  }

  return {
    deploymentId: props.deploymentId,
    modelId: props.modelId,
    presetId: props.presetId,
    backend: props.backend,
    activationPolicy: props.activationPolicy,
    document: props.document,
  };
});

const previewNote = computed<IPreviewNote | null>(() => {
  if (placementModeOf(selection.value) !== PlacementMode.PIN) {
    return null;
  }

  if (props.modelId === null) {
    return { text: NO_MODEL_NOTE, warning: false };
  }

  if (previewing.value) {
    return { text: PREVIEWING_NOTE, warning: false };
  }

  if (previewFailed.value) {
    return { text: PREVIEW_FAILED_NOTE, warning: false };
  }

  const problem = preview.value?.problem ?? null;

  return problem === null ? null : { text: `${problem}.`, warning: true };
});

const verdictOf = (nodeId: number): PlacementNodeDto | null =>
  isAnythingPinnedOn(selection.value, nodeId)
    ? (preview.value?.nodes.find(node => node.nodeId === nodeId) ?? null)
    : null;

const setMode = (next: PlacementMode) => {
  mode.value = next;

  if (next === PlacementMode.AUTOMATIC) {
    selection.value = { gpus: [], nodeIds: [] };
  }
};

const withDevices = (node: ListNodeDto): Promise<IPinnableNode> =>
  telemetryAdminService
    .getNodeTelemetryStatus(node.id)
    .then(status => ({
      id: node.id,
      name: node.name,
      state: node.state,
      devices: status.devices,
      headroomBytes: status.headroomBytes,
    }))
    .catch(() => ({ id: node.id, name: node.name, state: node.state, devices: [], headroomBytes: 0 }));

const doGetNodes = () => {
  loadingNodes.value = true;
  nodeAdminService
    .getNodeList({}, NODE_PAGE)
    .then(nodeListResponse => Promise.all(nodeListResponse.nodeList.map(node => withDevices(node))))
    .then(pinnable => {
      nodes.value = pinnable;
    })
    .finally(() => {
      loadingNodes.value = false;
    })
    .catch((error: unknown) => {
      logger.error({ error }, 'doGetNodes(): Failed to list the nodes a replica can be pinned to');
    });
};

/** Reads the request when the debounce fires, so one withdrawn in the meantime asks nothing. */
const doPreviewPlacement = () => {
  const request = previewRequest.value;

  if (request === null) {
    return;
  }

  const count = ++previewCount.value;

  previewing.value = true;
  instanceAdminService
    .previewPlacement(request)
    .then(response => {
      if (count === previewCount.value) {
        preview.value = response.placement;
        previewFailed.value = false;
      }
    })
    .finally(() => {
      if (count === previewCount.value) {
        previewing.value = false;
      }
    })
    .catch((error: unknown) => {
      if (count === previewCount.value) {
        preview.value = null;
        previewFailed.value = true;
      }

      logger.error({ error }, 'doPreviewPlacement(): Failed to check whether the selection fits');
    });
};

const debouncedPreviewPlacement = useDebounceFn(doPreviewPlacement, Config.PREVIEW_DEBOUNCE_MS);

// Every edit to the document moves the request, so a field that changes the figure is checked as a tick is.
watch(
  previewRequest,
  next => {
    if (next === null) {
      previewCount.value++;
      preview.value = null;
      previewing.value = false;

      return;
    }

    previewing.value = true;
    debouncedPreviewPlacement().catch((error: unknown) => {
      logger.error({ error }, 'watch(previewRequest): Failed to check whether the selection fits');
    });
  },
  { immediate: true }
);

// A document that names a placement wins, so opening a saved deployment lands on the mode it was saved in.
watch(
  () => placementModeOf(selection.value),
  next => {
    if (next !== PlacementMode.AUTOMATIC) {
      mode.value = next;
    }
  }
);

onMounted(() => {
  doGetNodes();
});
</script>
