import { IContainerInput, IEstimatedModel, IModelMetadata } from '../runtime';

export const buildModelMetadata = (overrides: Partial<IModelMetadata> = {}): IModelMetadata => ({
  sizeBytes: 4_368_439_296,
  architecture: 'llama',
  quantisation: 'Q4_K',
  layerCount: 32,
  embeddingLength: 4096,
  headCount: 32,
  headCountKv: 8,
  contextLength: 8192,

  ...overrides,
});

export const buildEstimatedModel = (overrides: Partial<IEstimatedModel> = {}): IEstimatedModel => ({
  ...buildModelMetadata(),
  tensors: null,

  ...overrides,
});

export const buildContainerInput = (overrides: Partial<IContainerInput> = {}): IContainerInput => ({
  instanceKey: 'inst_01hq9v',
  servedModel: 'chat-8b',
  model: buildModelMetadata(),
  weights: {
    hostPath: '/srv/models/llama-3-8b/model.gguf',
    containerPath: '/models/llama-3-8b/model.gguf',
  },
  shards: [],
  configuration: {
    contextSize: 8192,
    parallel: 4,
    flashAttn: 'on',
    extraFlags: ['--mirostat', '2'],
  },
  companions: [],
  pins: { cpu: false, gpus: ['GPU-11111111-2222-3333-4444-555555555555'] },
  gpuTotalBytes: new Map([['GPU-11111111-2222-3333-4444-555555555555', 24 * 1024 ** 3]]),
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',

  ...overrides,
});
