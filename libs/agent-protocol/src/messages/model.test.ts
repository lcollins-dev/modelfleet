import { describe, expect, it } from 'vitest';

import { decodeAgentMessage, decodeServerMessage, encodeAgentMessage, encodeServerMessage } from '../codec';
import { AgentMessageType, ServerMessageType } from '../message-type';
import {
  AgentModelInventory,
  MAX_GGUF_TENSORS,
  MAX_GGUF_TENSOR_NAME_LENGTH,
  MAX_LICENCE_ID_LENGTH,
  ModelFormat,
  ModelTask,
  ModelType,
  ProjectorModality,
  agentModelInventorySchema,
  modelFingerprintSchema,
} from './model';

const INVENTORY: AgentModelInventory = {
  scannedAt: '2026-08-20T12:00:00.000Z',
  directories: ['/var/lib/modelfleet/weights'],
  models: [
    {
      fingerprint: 'f'.repeat(64),
      format: ModelFormat.GGUF,
      type: ModelType.MODEL,
      sizeBytes: 4_920_000_000,
      path: '/var/lib/modelfleet/weights/llama.gguf',
      shardCount: 1,
      name: 'Llama 3 8B Instruct',
      ggufMetadata: {
        architecture: 'llama',
        quantisation: 'Q4_K',
        quantisationMixed: true,
        layerCount: 32,
        embeddingLength: 4096,
        headCount: 32,
        headCountKv: 8,
        contextLength: 8192,
        tensors: [{ name: 'token_embd.weight', sizeBytes: 369_098_752 }],
      },
      safetensorsMetadata: null,
    },
  ],
  errors: [],
};

describe('modelFingerprintSchema', () => {
  it('takes a lowercase hex sha-256', () => {
    expect(modelFingerprintSchema.safeParse('0123456789abcdef'.repeat(4)).success).toBe(true);
  });

  it('refuses an uppercase digest, so one fingerprint has one spelling', () => {
    expect(modelFingerprintSchema.safeParse('F'.repeat(64)).success).toBe(false);
  });

  it('refuses a digest of the wrong width', () => {
    expect(modelFingerprintSchema.safeParse('f'.repeat(63)).success).toBe(false);
  });
});

describe('agentModelInventorySchema', () => {
  const withTensors = (tensors: unknown): AgentModelInventory => ({
    ...INVENTORY,
    models: [{ ...INVENTORY.models[0], ggufMetadata: { ...INVENTORY.models[0].ggufMetadata!, tensors } as never }],
  });

  it('refuses a model listing more tensors than the cap', () => {
    const tensors = new Array(MAX_GGUF_TENSORS + 1).fill({ name: 'blk.0.ffn_up.weight', sizeBytes: 1 });

    expect(agentModelInventorySchema.safeParse(withTensors(tensors)).success).toBe(false);
  });

  it('refuses a tensor name longer than ggml allows', () => {
    const tensors = [{ name: 'x'.repeat(MAX_GGUF_TENSOR_NAME_LENGTH + 1), sizeBytes: 1 }];

    expect(agentModelInventorySchema.safeParse(withTensors(tensors)).success).toBe(false);
  });

  it('takes a model of a format carrying no gguf block', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], ggufMetadata: null }],
    });

    expect(result.success).toBe(true);
  });

  it('refuses a model with no name, since every format has a file to fall back on', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], name: '' }],
    });

    expect(result.success).toBe(false);
  });

  it('takes every type a catalogued file can be', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: Object.values(ModelType).map(type => ({ ...INVENTORY.models[0], type })),
    });

    expect(result.success).toBe(true);
  });

  it('refuses a type outside the list, so an unknown marker never reaches the catalogue', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], type: 'embedding' }],
    });

    expect(result.success).toBe(false);
  });

  it('takes gguf metadata listing no tensors from an agent predating the field', () => {
    const metadata: Record<string, unknown> = { ...INVENTORY.models[0].ggufMetadata };

    delete metadata.tensors;

    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], ggufMetadata: metadata }],
    });

    expect(result.success).toBe(true);
  });

  it('leaves the type unstated where the reporting agent predates the field', () => {
    const reported: Record<string, unknown> = { ...INVENTORY.models[0] };

    delete reported.type;

    const result = agentModelInventorySchema.safeParse({ ...INVENTORY, models: [reported] });

    expect(result.success).toBe(true);
    expect(result.success && result.data.models[0].type).toBeUndefined();
  });

  it('takes a task, a licence and the modalities a projector feeds', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [
        {
          ...INVENTORY.models[0],
          task: ModelTask.TRANSCRIPTION,
          licence: { id: 'other', name: 'fish-audio-research', link: 'https://example.com/LICENSE' },
          modalities: [ProjectorModality.VISION, ProjectorModality.AUDIO],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('keeps a null task apart from one an agent predating the field left out', () => {
    const unstated: Record<string, unknown> = { ...INVENTORY.models[0] };

    delete unstated.task;

    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], task: null }, unstated],
    });

    expect(result.success && result.data.models.map(model => model.task)).toEqual([null, undefined]);
  });

  it('refuses a task outside the list', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], task: 'translation' }],
    });

    expect(result.success).toBe(false);
  });

  it('takes the tasks a model holds, and none', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [
        { ...INVENTORY.models[0], tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH] },
        { ...INVENTORY.models[0], tasks: [] },
      ],
    });

    expect(result.success && result.data.models.map(model => model.tasks)).toEqual([
      [ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH],
      [],
    ]);
  });

  it('refuses tasks outside the list, or more of them than there are tasks', () => {
    const outside = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], tasks: ['translation'] }],
    });
    const surplus = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], tasks: [...Object.values(ModelTask), ModelTask.CHAT] }],
    });

    expect(outside.success).toBe(false);
    expect(surplus.success).toBe(false);
  });

  it('refuses a licence identifier past its cap', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [
        { ...INVENTORY.models[0], licence: { id: 'x'.repeat(MAX_LICENCE_ID_LENGTH + 1), name: null, link: null } },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('refuses a shard count below one, since every model has a first shard', () => {
    const result = agentModelInventorySchema.safeParse({
      ...INVENTORY,
      models: [{ ...INVENTORY.models[0], shardCount: 0 }],
    });

    expect(result.success).toBe(false);
  });
});

describe('the model inventory on the wire', () => {
  it('survives a round trip', () => {
    const decoded = decodeAgentMessage(encodeAgentMessage(AgentMessageType.MODEL_INVENTORY, INVENTORY));

    expect(decoded.ok && decoded.message.payload).toEqual(INVENTORY);
  });

  it('carries a scan request the other way', () => {
    const decoded = decodeServerMessage(encodeServerMessage(ServerMessageType.SCAN_MODELS, {}));

    expect(decoded.ok && decoded.message.type).toBe(ServerMessageType.SCAN_MODELS);
  });
});
