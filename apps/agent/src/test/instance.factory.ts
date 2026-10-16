import { DesiredInstance, InstanceState, ObservedInstance } from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';

export const TEST_INSTANCE_KEY = '01999999-1111-7111-8111-111111111111';
export const TEST_DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

export const buildDesiredInstance = (overrides: Partial<DesiredInstance> = {}): DesiredInstance => ({
  instanceKey: TEST_INSTANCE_KEY,
  revision: 1,
  backend: BackendId.LLAMA_CPP,
  servedModel: 'chat-8b',
  model: {
    sizeBytes: 4_368_439_296,
    architecture: 'llama',
    quantisation: 'Q4_K',
    layerCount: 32,
    embeddingLength: 4096,
    headCount: 32,
    headCountKv: 8,
    contextLength: 8192,
  },
  weightsPath: '/srv/models/llama-3-8b/model.gguf',
  configuration: { contextSize: 8192 },
  pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',

  ...overrides,
});

export const buildObservedInstance = (overrides: Partial<ObservedInstance> = {}): ObservedInstance => ({
  instanceKey: TEST_INSTANCE_KEY,
  revision: 1,
  instanceState: InstanceState.READY,
  message: null,
  uptimeMs: 60_000,
  exitCode: null,

  ...overrides,
});
