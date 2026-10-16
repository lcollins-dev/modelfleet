import {
  BackendField,
  BackendFieldType,
  CONFIGURATION_SCHEMA_VERSION,
  BackendDeclaration,
  BooleanBackendField,
  extraFlagsField,
} from '../../configuration';
import { BackendImages, imageField } from '../../definition';
import { ModelFormat } from '../../model';

export const VLLM_IMAGES: BackendImages = { cuda: 'vllm/vllm-openai:v0.31.0' };

export const GPU_MEMORY_UTILIZATION_FIELD = 'gpuMemoryUtilization';

const CONTAINER = 'container';
const MEMORY = 'memory';
const SERVER = 'server';
const ADVANCED = 'advanced';

export function enforceEagerField(group: string): BooleanBackendField {
  return {
    name: 'enforceEager',
    flag: '--enforce-eager',
    label: 'Eager mode',
    description:
      'Skip compiling and capturing CUDA graphs. The instance starts sooner and needs less memory, but runs slower.',
    group,
    type: BackendFieldType.BOOLEAN,
  };
}

const fields: BackendField[] = [
  imageField({
    group: CONTAINER,
    images: VLLM_IMAGES,
    description: 'Choose the container image and tag for each instance.',
  }),

  {
    name: GPU_MEMORY_UTILIZATION_FIELD,
    flag: '--gpu-memory-utilization',
    label: 'GPU memory share',
    description:
      'Set the share of each GPU this instance takes, from 0.05 to 1. vLLM fills it with the weights and its ' +
      'cache, and the share is what the instance is sized by when it is placed.',
    group: MEMORY,
    type: BackendFieldType.NUMBER,
    default: 0.92,
    min: 0.05,
    max: 1,
  },
  {
    name: 'maxNumSeqs',
    flag: '--max-num-seqs',
    label: 'Concurrent requests',
    description: 'Set the most requests the instance serves at once. Fewer leaves more of the share for each one.',
    group: MEMORY,
    type: BackendFieldType.INTEGER,
    min: 1,
  },
  enforceEagerField(MEMORY),

  {
    name: 'dtype',
    flag: '--dtype',
    label: 'Data type',
    description: "Choose the precision the weights run in. Auto takes the model's own.",
    group: SERVER,
    type: BackendFieldType.CHOICE,
    choices: ['auto', 'half', 'float16', 'bfloat16', 'float32'],
  },

  extraFlagsField(ADVANCED),
];

export const vllmDeclaration: BackendDeclaration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.SAFETENSORS],
  groups: [
    { group: CONTAINER, label: 'Container' },
    { group: MEMORY, label: 'Memory and batching' },
    { group: SERVER, label: 'Server behaviour' },
    { group: ADVANCED, label: 'Advanced' },
  ],
  fields,
};
