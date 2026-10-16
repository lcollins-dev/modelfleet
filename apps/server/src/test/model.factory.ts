import { ModelFormat, ModelType } from '@libs/agent-protocol';

import { Availability } from '@/core/model/entities/availability.entity';
import { Model } from '@/core/model/entities/model.entity';

import { TEST_NODE_ID } from '@/test/node.factory';

export const TEST_MODEL_ID = 11;
export const TEST_FINGERPRINT = 'a'.repeat(64);

/** Builds a model as a row read back from the database, generated columns included. */
export const buildModel = (overrides: Partial<Model> = {}): Model => {
  const model = new Model({
    fingerprint: TEST_FINGERPRINT,
    format: ModelFormat.GGUF,
    type: ModelType.MODEL,
    detectedTasks: [],
    licence: null,
    modalities: null,
    sizeBytes: 4_920_000_000,
    shardCount: 1,
    name: 'Llama 3 8B',
    ggufMetadata: null,
    safetensorsMetadata: null,
  });

  model.id = TEST_MODEL_ID;
  model.createdDate = new Date('2026-08-20T09:00:00Z');

  Object.assign(model, overrides);

  return model;
};

/** Builds an availability entry as a row read back from the database, generated columns included. */
export const buildAvailability = (overrides: Partial<Availability> = {}): Availability => {
  const availability = new Availability({
    modelId: TEST_MODEL_ID,
    nodeId: TEST_NODE_ID,
    path: '/models/llama-3-8b.gguf',
    lastConfirmedDate: new Date('2026-08-20T09:00:00Z'),
  });

  availability.id = 1;
  availability.createdDate = new Date('2026-08-20T09:00:00Z');

  Object.assign(availability, overrides);

  return availability;
};
