import { DesiredInstance, InstanceState, ObservedInstance } from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';

import { Instance } from '@/core/instance/entities/instance.entity';

import { TEST_DEPLOYMENT_ID, TEST_REVISION } from '@/test/deployment.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

export const TEST_INSTANCE_KEY = '01999999-1111-7111-8111-111111111111';
export const TEST_DEVICE_KEY = 'GPU-11111111-2222-3333-4444-555555555555';

/** Builds an instance as a row read back from the database, generated columns included. */
export const buildInstance = (overrides: Partial<Instance> = {}): Instance => {
  const instance = new Instance({
    instanceKey: TEST_INSTANCE_KEY,
    deploymentId: TEST_DEPLOYMENT_ID,
    nodeId: TEST_NODE_ID,
    revision: 1,
    configurationRevision: TEST_REVISION,
    pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
  });

  instance.id = 5;
  instance.createdDate = new Date('2026-08-20T09:00:00Z');
  instance.updatedDate = new Date('2026-08-20T09:00:00Z');

  Object.assign(instance, overrides);

  return instance;
};

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
