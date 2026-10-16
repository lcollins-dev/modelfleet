import { z } from 'zod';

import { ModelFormat, ModelTask, ModelType, ProjectorModality } from '@libs/backends';

import { timestamp } from '../../../fields';
import { NodeState } from '../node';

export { ModelFormat, ModelTask, ModelType, ProjectorModality };

export const UNKNOWN_MODEL_TASK = 'unknown';

export type ModelTaskFilter = ModelTask | typeof UNKNOWN_MODEL_TASK;

/** Shown, never enforced. */
export enum LicenceTerms {
  NON_COMMERCIAL = 'non-commercial',
  CUSTOM = 'custom',
}

export const ModelLicenceDto = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** As the card states it: a URL or a path inside the repository. */
  link: z.string().nullable(),
  terms: z.enum(LicenceTerms).nullable(),
});
export type ModelLicenceDto = z.infer<typeof ModelLicenceDto>;

export enum ModelState {
  AVAILABLE = 'available',
  UNAVAILABLE = 'unavailable',
}

export const GgufModelMetadataDto = z.object({
  architecture: z.string().nullable(),
  quantisation: z.string().nullable(),
  quantisationMixed: z.boolean(),
  layerCount: z.number().nullable(),
  embeddingLength: z.number().nullable(),
  headCount: z.number().nullable(),
  headCountKv: z.number().nullable(),
  contextLength: z.number().nullable(),
});
export type GgufModelMetadataDto = z.infer<typeof GgufModelMetadataDto>;

export const SafetensorsModelMetadataDto = z.object({
  dtype: z.string().nullable(),
  tensorCount: z.number(),
  parameterCount: z.number(),

  architecture: z.string().nullable(),
});
export type SafetensorsModelMetadataDto = z.infer<typeof SafetensorsModelMetadataDto>;

export const ModelAvailabilityDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),
  nodeState: z.enum(NodeState),
  path: z.string(),
  lastConfirmedDate: timestamp(),
});
export type ModelAvailabilityDto = z.infer<typeof ModelAvailabilityDto>;

export const ListModelDto = z.object({
  id: z.number(),
  fingerprint: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  format: z.enum(ModelFormat),
  type: z.enum(ModelType),
  tasks: z.array(z.enum(ModelTask)),
  licence: ModelLicenceDto.nullable(),
  quantisation: z.string().nullable(),

  /** True where `quantisation` names the largest share of a mix rather than the whole file. */
  quantisationMixed: z.boolean(),

  sizeBytes: z.number(),
  shardCount: z.number(),
  state: z.enum(ModelState),
  availability: z.array(ModelAvailabilityDto),
});
export type ListModelDto = z.infer<typeof ListModelDto>;

export const ModelDto = ListModelDto.extend({
  ggufMetadata: GgufModelMetadataDto.nullable(),
  safetensorsMetadata: SafetensorsModelMetadataDto.nullable(),
  modalities: z.array(z.enum(ProjectorModality)).nullable(),

  detectedTasks: z.array(z.enum(ModelTask)),

  tasksAssigned: z.boolean(),

  createdDate: timestamp(),
});
export type ModelDto = z.infer<typeof ModelDto>;
