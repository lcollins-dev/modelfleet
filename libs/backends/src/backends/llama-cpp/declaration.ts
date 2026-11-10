import {
  BackendField,
  BackendFieldType,
  CONFIGURATION_SCHEMA_VERSION,
  BackendDeclaration,
  extraFlagsField,
} from '../../configuration';
import { BackendImages, imageField } from '../../definition';
import { ModelFormat, ModelType } from '../../model';

export enum LlamaCppField {
  CONTEXT_SIZE = 'contextSize',
  UBATCH_SIZE = 'ubatchSize',
  PARALLEL = 'parallel',
  CPU_MOE = 'cpuMoe',
  CPU_MOE_LAYERS = 'cpuMoeLayers',
  TENSOR_OVERRIDES = 'tensorOverrides',
  SPLIT_MODE = 'splitMode',
  TENSOR_SPLIT = 'tensorSplit',
  FLASH_ATTN = 'flashAttn',
  FIT_TARGET = 'fitTarget',
  NO_MMPROJ_OFFLOAD = 'noMmprojOffload',
  CACHE_TYPE_K = 'cacheTypeK',
  CACHE_TYPE_V = 'cacheTypeV',
  NO_KV_OFFLOAD = 'noKvOffload',
  LOAD_MODE = 'loadMode',
  LAZY_MODE = 'lazyMode',
  PROMPT_CACHE = 'promptCache',
  PROJECTOR = 'mmproj',
  DRAFT_MODEL = 'draftModel',
  SPECULATIVE_TYPE = 'speculativeType',
  DRAFT_TOKENS = 'draftTokens',
}

/** Bump only after checking the declaration, the estimate and the hooks against the new build. */
const RELEASE = 'b12063';

export const LLAMA_CPP_IMAGES: BackendImages = {
  cuda: `ghcr.io/ggml-org/llama.cpp:server-cuda-${RELEASE}`,
  cpu: `ghcr.io/ggml-org/llama.cpp:server-${RELEASE}`,
};

const CACHE_TYPES = ['f32', 'f16', 'bf16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'];

const CONTAINER = 'container';
const CONTEXT = 'context';
const GPU = 'gpu';
const MEMORY = 'memory';
const CPU = 'cpu';
const ROPE = 'rope';
const MULTIMODAL = 'multimodal';
const SPECULATIVE = 'speculative';
const SERVER = 'server';
const ADVANCED = 'advanced';

const fields: BackendField[] = [
  imageField({
    group: CONTAINER,
    images: LLAMA_CPP_IMAGES,
    description: 'Choose the container image and tag for each instance.',
  }),

  {
    name: LlamaCppField.CONTEXT_SIZE,
    flag: '--ctx-size',
    label: 'Context size',
    description: "Set the context length in tokens. Use 0 for the model's trained context length.",
    group: CONTEXT,
    type: BackendFieldType.INTEGER,
    default: 4096,
    min: 0,
  },
  {
    name: 'batchSize',
    flag: '--batch-size',
    label: 'Logical batch size',
    description: 'Set the number of tokens submitted to the backend in each logical batch.',
    group: CONTEXT,
    type: BackendFieldType.INTEGER,
    min: 1,
  },
  {
    name: LlamaCppField.UBATCH_SIZE,
    flag: '--ubatch-size',
    label: 'Physical batch size',
    description: 'Set the number of tokens the backend processes in each pass.',
    group: CONTEXT,
    type: BackendFieldType.INTEGER,
    default: 512,
    min: 1,
  },
  {
    name: LlamaCppField.PARALLEL,
    flag: '--parallel',
    label: 'Parallel slots',
    description: 'Set the number of requests served at once. Each request receives an equal share of the context.',
    group: CONTEXT,
    type: BackendFieldType.INTEGER,
    default: 1,
    min: 1,
  },

  {
    name: LlamaCppField.CPU_MOE,
    flag: '--cpu-moe',
    label: 'All expert layers on the CPU',
    description: "Keep every mixture-of-experts layer's experts in RAM. This frees the most VRAM but reduces speed.",
    group: GPU,
    type: BackendFieldType.BOOLEAN,
  },
  {
    name: LlamaCppField.CPU_MOE_LAYERS,
    flag: '--n-cpu-moe',
    label: 'Expert layers on the CPU',
    description:
      'Set how many mixture-of-experts layers stay in RAM, starting with the first layer. This reduces ' +
      'VRAM use when the whole model does not fit on the GPU.',
    group: GPU,
    type: BackendFieldType.INTEGER,
    min: 0,
  },
  {
    name: LlamaCppField.TENSOR_OVERRIDES,
    flag: '--override-tensor',
    label: 'Tensor overrides',
    description:
      'Send the tensors whose names match a pattern to another device, one pattern=device entry each, such as ' +
      'token_embd.weight=CPU. CPU keeps a tensor in RAM, off the GPUs.',
    group: GPU,
    type: BackendFieldType.TEXT_LIST,
  },
  {
    name: LlamaCppField.SPLIT_MODE,
    flag: '--split-mode',
    label: 'Split mode',
    description:
      'Choose how to split the model across GPUs. Tensor mode is experimental, requires flash attention and ' +
      'disables automatic fitting. The whole model must fit in VRAM, divided equally unless you set Tensor split.',
    group: GPU,
    type: BackendFieldType.CHOICE,
    choices: ['none', 'layer', 'tensor'],
  },
  {
    name: LlamaCppField.TENSOR_SPLIT,
    flag: '--tensor-split',
    label: 'Tensor split',
    description: 'Set the proportion of the model placed on each GPU. List the proportions in device order.',
    group: GPU,
    type: BackendFieldType.NUMBER_LIST,
    min: 0,
  },
  {
    name: LlamaCppField.FLASH_ATTN,
    flag: '--flash-attn',
    label: 'Flash attention',
    description: 'Choose whether to use flash attention kernels. Auto lets the backend decide.',
    group: GPU,
    type: BackendFieldType.CHOICE,
    choices: ['auto', 'on', 'off'],
  },
  {
    name: LlamaCppField.FIT_TARGET,
    flag: '--fit-target',
    label: 'Fit target (MiB)',
    description:
      "Set how much VRAM, in MiB, automatic fitting leaves free on each GPU. The VRAM check uses this in place of the node's " +
      'headroom. This has no effect in tensor mode, or with a tensor split across several GPUs, tensor overrides or ' +
      'expert layers on the CPU, since those turn automatic fitting off.',
    group: GPU,
    type: BackendFieldType.INTEGER,
    min: 0,
  },
  {
    name: LlamaCppField.NO_MMPROJ_OFFLOAD,
    flag: '--no-mmproj-offload',
    label: 'Keep the projector off the GPU',
    description: 'Keep the multimodal projector in RAM. This frees VRAM for the model but slows image and audio input.',
    group: GPU,
    type: BackendFieldType.BOOLEAN,
  },

  {
    name: LlamaCppField.CACHE_TYPE_K,
    flag: '--cache-type-k',
    label: 'K cache type',
    description:
      'Choose the quantisation type for the key cache. Smaller types allow a longer context but reduce accuracy.',
    group: MEMORY,
    type: BackendFieldType.CHOICE,
    choices: CACHE_TYPES,
    default: 'f16',
  },
  {
    name: LlamaCppField.CACHE_TYPE_V,
    flag: '--cache-type-v',
    label: 'V cache type',
    description: 'Choose the quantisation type for the value cache.',
    group: MEMORY,
    type: BackendFieldType.CHOICE,
    choices: CACHE_TYPES,
    default: 'f16',
  },
  {
    name: LlamaCppField.NO_KV_OFFLOAD,
    flag: '--no-kv-offload',
    label: 'Keep the KV cache off the GPU',
    description: 'Keep the key and value cache in RAM. This frees VRAM but reduces speed.',
    group: MEMORY,
    type: BackendFieldType.BOOLEAN,
  },
  {
    name: LlamaCppField.LOAD_MODE,
    flag: '--load-mode',
    label: 'Load mode',
    description:
      'Choose how to read and hold the weights. Leave this unset to map the file when the device supports it. ' +
      'Mlock also prevents the host from swapping the weights out.',
    group: MEMORY,
    type: BackendFieldType.CHOICE,
    choices: ['auto', 'none', 'mmap', 'mlock', 'mmap+mlock', 'dio'],
  },
  {
    name: LlamaCppField.LAZY_MODE,
    flag: '--lazy-mode',
    label: 'Lazy mode',
    description:
      'Choose when to read a per-layer lookup table from disk row by row instead of holding it in memory. Leave ' +
      'this unset to do so for a table over 4 GiB. On does so at any size, and off never does.',
    group: MEMORY,
    type: BackendFieldType.CHOICE,
    choices: ['auto', 'on', 'off'],
  },
  {
    name: LlamaCppField.PROMPT_CACHE,
    flag: '--cache-ram',
    label: 'Prompt cache (MiB)',
    description:
      'Set the most RAM the prompt cache can grow to, in MiB. Use 0 to disable the cache. Leave this unset ' +
      "to keep the backend's own default.",
    group: MEMORY,
    type: BackendFieldType.INTEGER,
    min: 0,
  },

  {
    name: 'threads',
    flag: '--threads',
    label: 'Threads',
    description:
      'Set the number of threads used for generation. Leave this unset to let the backend count available cores.',
    group: CPU,
    type: BackendFieldType.INTEGER,
    min: 1,
  },
  {
    name: 'threadsBatch',
    flag: '--threads-batch',
    label: 'Batch threads',
    description: 'Set the number of threads used for prompt processing when it differs from generation.',
    group: CPU,
    type: BackendFieldType.INTEGER,
    min: 1,
  },
  {
    name: 'numa',
    flag: '--numa',
    label: 'NUMA strategy',
    description: 'Choose how to place threads across NUMA nodes on a multi-socket host.',
    group: CPU,
    type: BackendFieldType.CHOICE,
    choices: ['distribute', 'isolate', 'numactl'],
  },

  {
    name: 'ropeScaling',
    flag: '--rope-scaling',
    label: 'RoPE scaling',
    description: 'Choose how to extend the context beyond the length used to train the model.',
    group: ROPE,
    type: BackendFieldType.CHOICE,
    choices: ['none', 'linear', 'yarn'],
  },
  {
    name: 'ropeScale',
    flag: '--rope-scale',
    label: 'RoPE scale',
    description: 'Set the factor used to extend the context when the scaling method requires one.',
    group: ROPE,
    type: BackendFieldType.NUMBER,
    min: 0,
  },
  {
    name: 'ropeFreqBase',
    flag: '--rope-freq-base',
    label: 'RoPE frequency base',
    description: "Set a base frequency that overrides the model's value.",
    group: ROPE,
    type: BackendFieldType.NUMBER,
    min: 0,
  },
  {
    name: 'ropeFreqScale',
    flag: '--rope-freq-scale',
    label: 'RoPE frequency scale',
    description: 'Set the frequency scaling factor applied to the base.',
    group: ROPE,
    type: BackendFieldType.NUMBER,
    min: 0,
  },

  {
    name: LlamaCppField.PROJECTOR,
    flag: '--mmproj',
    label: 'Projector',
    description:
      'Choose the multimodal projector that lets this model read images. Pick the projector published with the ' +
      'model, and make sure every node this deployment runs on holds it.',
    group: MULTIMODAL,
    type: BackendFieldType.MODEL_REFERENCE,
    modelType: ModelType.PROJECTOR,
  },

  {
    name: LlamaCppField.DRAFT_MODEL,
    flag: '--spec-draft-model',
    label: 'Draft model',
    description:
      'Choose the draft model that drafts tokens ahead of this model. Pick a DSpark, DFlash, Eagle3 or MTP file made ' +
      'for this model, and make sure every node this deployment runs on holds it.',
    group: SPECULATIVE,
    type: BackendFieldType.MODEL_REFERENCE,
    modelType: ModelType.DRAFT,
  },
  {
    name: LlamaCppField.SPECULATIVE_TYPE,
    flag: '--spec-type',
    label: 'Speculative type',
    description:
      'Choose how to draft tokens. DFlash, DSpark and Eagle3 take effect only with a draft model of that kind, and ' +
      'MTP with an MTP draft model or MTP layers in the main model. Leave this unset to detect the type from the ' +
      'draft model.',
    group: SPECULATIVE,
    type: BackendFieldType.CHOICE,
    choices: ['draft-mtp', 'draft-dflash', 'draft-dspark', 'draft-eagle3'],
  },
  {
    name: LlamaCppField.DRAFT_TOKENS,
    flag: '--spec-draft-n-max',
    label: 'Draft tokens',
    description: 'Set the most tokens to draft at once. This takes effect only while speculative decoding runs.',
    group: SPECULATIVE,
    type: BackendFieldType.INTEGER,
    min: 0,
  },

  {
    name: 'contBatching',
    flag: '--cont-batching',
    offFlag: '--no-cont-batching',
    label: 'Continuous batching',
    description: 'Allow a new request to join a batch that is already running.',
    group: SERVER,
    type: BackendFieldType.BOOLEAN,
  },
  {
    name: 'jinja',
    flag: '--jinja',
    offFlag: '--no-jinja',
    label: 'Jinja chat templates',
    description: "Render chat with the model's Jinja template. Tool calling requires this option.",
    group: SERVER,
    type: BackendFieldType.BOOLEAN,
    default: true,
  },
  {
    name: 'chatTemplate',
    flag: '--chat-template',
    label: 'Chat template',
    description: "Set a named template that overrides the template in the model's metadata.",
    group: SERVER,
    type: BackendFieldType.TEXT,
  },
  {
    name: 'embeddings',
    flag: '--embeddings',
    label: 'Serve embeddings',
    description: 'Serve the embeddings endpoint instead of chat completions.',
    group: SERVER,
    type: BackendFieldType.BOOLEAN,
  },
  {
    name: 'reranking',
    flag: '--reranking',
    label: 'Serve reranking',
    description: 'Serve the reranking endpoint. Use a model trained to score pairs.',
    group: SERVER,
    type: BackendFieldType.BOOLEAN,
  },
  {
    name: 'pooling',
    flag: '--pooling',
    label: 'Embedding pooling',
    description: 'Choose how to pool token embeddings into one vector.',
    group: SERVER,
    type: BackendFieldType.CHOICE,
    choices: ['none', 'mean', 'cls', 'last', 'rank'],
  },
  {
    name: 'metrics',
    flag: '--metrics',
    label: 'Prometheus metrics',
    description: "Expose the backend's metrics endpoint.",
    group: SERVER,
    type: BackendFieldType.BOOLEAN,
  },

  extraFlagsField(ADVANCED),
];

export const llamaCppDeclaration: BackendDeclaration = {
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.GGUF],
  groups: [
    { group: CONTAINER, label: 'Container' },
    { group: CONTEXT, label: 'Context and batching' },
    { group: GPU, label: 'GPU offload' },
    { group: MEMORY, label: 'Memory and cache' },
    { group: CPU, label: 'CPU' },
    { group: ROPE, label: 'Context extension' },
    { group: MULTIMODAL, label: 'Multimodal' },
    { group: SPECULATIVE, label: 'Speculative decoding' },
    { group: SERVER, label: 'Server behaviour' },
    { group: ADVANCED, label: 'Advanced' },
  ],
  fields,
  referenceRequirements: [
    {
      choiceField: LlamaCppField.SPECULATIVE_TYPE,
      choices: ['draft-dflash', 'draft-dspark'],
      referenceField: LlamaCppField.DRAFT_MODEL,
      architecture: 'dflash',
    },
  ],
};
