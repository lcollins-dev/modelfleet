import { z } from 'zod';

import { MODEL_FINGERPRINT_PATTERN, ModelFormat, ModelTask, ModelType, ProjectorModality } from '@libs/backends';

import { MAX_MESSAGE_LENGTH } from './limits';

export { ModelFormat, ModelTask, ModelType, ProjectorModality };

export enum ModelScanErrorScope {
  DIRECTORY = 'directory',
  MODEL = 'model',
  MODEL_SET = 'model-set',
  INVENTORY = 'inventory',
}

export const MAX_MODEL_DIRECTORIES = 32;
export const MAX_MODELS_PER_NODE = 256;
export const MAX_MODEL_SCAN_ERRORS = 64;
export const MAX_MODEL_PATH_LENGTH = 1024;
export const MAX_LICENCE_ID_LENGTH = 128;
export const MAX_LICENCE_NAME_LENGTH = 256;
export const MAX_LICENCE_LINK_LENGTH = 1024;
export const MAX_GGUF_TENSORS = 1024;
export const MAX_ARCHITECTURE_LENGTH = 64;
export const MAX_QUANTISATION_LENGTH = 32;
export const MAX_DTYPE_LENGTH = 32;
export const MAX_MODEL_NAME_LENGTH = 256;
export const MAX_MODEL_TASKS = Object.values(ModelTask).length;

/** Across every model a node reports, so its inventory stays inside the server's frame cap. */
export const MAX_INVENTORY_TENSORS = 2048;

/** `GGML_MAX_NAME`, which counts the terminating null. */
export const MAX_GGUF_TENSOR_NAME_LENGTH = 63;

/** The identity the server merges two nodes' reports on. */
export const modelFingerprintSchema = z.string().regex(MODEL_FINGERPRINT_PATTERN);

export const ggufTensorSchema = z.object({
  name: z.string().min(1).max(MAX_GGUF_TENSOR_NAME_LENGTH),
  sizeBytes: z.number().int().nonnegative(),
});
export type GgufTensor = z.infer<typeof ggufTensorSchema>;

export const ggufMetadataSchema = z.object({
  architecture: z.string().min(1).max(MAX_ARCHITECTURE_LENGTH).nullable(),

  /** The `ggml_type` holding the most weights. It names the largest share alone where the file is mixed. */
  quantisation: z.string().min(1).max(MAX_QUANTISATION_LENGTH).nullable(),

  quantisationMixed: z.boolean(),

  layerCount: z.number().int().nonnegative().nullable(),
  embeddingLength: z.number().int().nonnegative().nullable(),
  headCount: z.number().int().nonnegative().nullable(),
  headCountKv: z.number().int().nonnegative().nullable(),
  contextLength: z.number().int().nonnegative().nullable(),

  /**
   * The largest tensors across every shard, down to a floor the agent sets, so a small one is never listed. Null
   * where a shard or a tensor type will not read, and absent from an agent predating the field.
   */
  tensors: z.array(ggufTensorSchema).max(MAX_GGUF_TENSORS).nullable().optional(),
});
export type GgufMetadata = z.infer<typeof ggufMetadataSchema>;

export const safetensorsMetadataSchema = z.object({
  dtype: z.string().min(1).max(MAX_DTYPE_LENGTH).nullable(),
  tensorCount: z.number().int().nonnegative(),
  parameterCount: z.number().int().nonnegative(),

  /** Absent from an agent predating the field. */
  architecture: z.string().min(1).max(MAX_ARCHITECTURE_LENGTH).nullable().optional(),
});
export type SafetensorsMetadata = z.infer<typeof safetensorsMetadataSchema>;

export const modelLicenceSchema = z.object({
  id: z.string().min(1).max(MAX_LICENCE_ID_LENGTH),
  name: z.string().min(1).max(MAX_LICENCE_NAME_LENGTH).nullable(),
  link: z.string().min(1).max(MAX_LICENCE_LINK_LENGTH).nullable(),
});
export type ModelLicence = z.infer<typeof modelLicenceSchema>;

export const modelEntrySchema = z.object({
  fingerprint: modelFingerprintSchema,
  format: z.enum(ModelFormat),

  /** Absent from an agent predating the field, which states nothing about what it holds rather than stating `model`. */
  type: z.enum(ModelType).optional(),

  /** Absent from an agent predating it, which reports `task` instead. */
  tasks: z.array(z.enum(ModelTask)).max(MAX_MODEL_TASKS).optional(),

  /** Each of these three is absent from an agent predating it. */
  task: z.enum(ModelTask).nullable().optional(),
  licence: modelLicenceSchema.nullable().optional(),

  /** Stated by a projector alone. */
  modalities: z.array(z.enum(ProjectorModality)).max(2).nullable().optional(),

  /** The sum of the set where the model is sharded. */
  sizeBytes: z.number().int().nonnegative(),

  /** This node's path to the model: the first shard, or the directory where the format is one. */
  path: z.string().min(1).max(MAX_MODEL_PATH_LENGTH),

  shardCount: z.number().int().positive(),

  /** For display only. A format naming nothing falls back to the file's own name. */
  name: z.string().min(1).max(MAX_MODEL_NAME_LENGTH),

  /** Each block is null on a model of any other format, which carries its own instead. */
  ggufMetadata: ggufMetadataSchema.nullable(),
  safetensorsMetadata: safetensorsMetadataSchema.nullable(),
});
export type ModelEntry = z.infer<typeof modelEntrySchema>;

export const modelScanErrorSchema = z.object({
  scope: z.enum(ModelScanErrorScope),
  path: z.string().min(1).max(MAX_MODEL_PATH_LENGTH).nullable(),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});
export type ModelScanError = z.infer<typeof modelScanErrorSchema>;

/** The node's whole model set: a model absent from this list is one the node no longer holds. */
export const agentModelInventorySchema = z.object({
  scannedAt: z.iso.datetime({ offset: true }),

  directories: z.array(z.string().min(1).max(MAX_MODEL_PATH_LENGTH)).max(MAX_MODEL_DIRECTORIES),

  models: z.array(modelEntrySchema).max(MAX_MODELS_PER_NODE),

  errors: z.array(modelScanErrorSchema).max(MAX_MODEL_SCAN_ERRORS),
});
export type AgentModelInventory = z.infer<typeof agentModelInventorySchema>;

export const serverScanModelsSchema = z.object({});
export type ServerScanModels = z.infer<typeof serverScanModelsSchema>;
