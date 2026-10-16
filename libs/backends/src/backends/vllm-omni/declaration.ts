import {
  BackendField,
  BackendFieldType,
  CONFIGURATION_SCHEMA_VERSION,
  BackendDeclaration,
  extraFlagsField,
} from '../../configuration';
import { BackendImages, imageField } from '../../definition';
import { ModelFormat } from '../../model';
import { enforceEagerField } from '../vllm/declaration';

export const VLLM_OMNI_IMAGES: BackendImages = { cuda: 'vllm/vllm-omni:v0.30.0' };

export const GPU_MEMORY_GIB_FIELD = 'gpuMemoryGib';

const CONTAINER = 'container';
const MEMORY = 'memory';
const ADVANCED = 'advanced';

const fields: BackendField[] = [
  imageField({
    group: CONTAINER,
    images: VLLM_OMNI_IMAGES,
    description: 'Choose the container image and tag for each instance.',
  }),

  {
    name: GPU_MEMORY_GIB_FIELD,
    label: 'GPU memory (GiB)',
    description:
      "Set the GPU memory the instance takes, in GiB. It is split between the stages of the model's pipeline in " +
      "the proportions vLLM-Omni's own deploy config gives them, as a share of the card the instance runs on.",
    group: MEMORY,
    type: BackendFieldType.NUMBER,
    default: 12,
    min: 1,
    max: 1024,
  },
  enforceEagerField(MEMORY),

  extraFlagsField(ADVANCED),
];

export const vllmOmniDeclaration: BackendDeclaration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.SAFETENSORS],
  groups: [
    { group: CONTAINER, label: 'Container' },
    { group: MEMORY, label: 'Memory' },
    { group: ADVANCED, label: 'Advanced' },
  ],
  fields,
};
