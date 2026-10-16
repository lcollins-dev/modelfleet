import { z } from 'zod';

import { enumValue, optionalText, requestBody, selection, text, timestamp } from '../../../fields';
import { ListModelDto, ModelFormat, ModelState, ModelTask, ModelType, UNKNOWN_MODEL_TASK } from './model';

export const ModelListRequestDto = requestBody({
  /** Matches a model's name, its display name or its fingerprint. */
  search: optionalText(512),
  state: selection(enumValue(ModelState), 1, 2).optional(),
  type: selection(enumValue(ModelType), 1, 4).optional(),
  task: selection(
    z.union([enumValue(ModelTask), z.literal(UNKNOWN_MODEL_TASK)], { error: 'Choose an option from the list.' }),
    1,
    5
  ).optional(),
  format: selection(enumValue(ModelFormat), 1, 2).optional(),
});
export type ModelListRequestDto = z.infer<typeof ModelListRequestDto>;

export const UpdateModelRequestDto = requestBody({
  /** A blank display name clears it, and the model falls back to its name. */
  displayName: text(0, 256, { trim: true }).optional(),

  /** Empty returns the model to the tasks the scans read. */
  tasks: selection(enumValue(ModelTask), 0, Object.values(ModelTask).length).optional(),
});
export type UpdateModelRequestDto = z.infer<typeof UpdateModelRequestDto>;

export const ModelListResponseDto = z.object({
  modelList: z.array(ListModelDto),
  pages: z.number(),
});
export type ModelListResponseDto = z.infer<typeof ModelListResponseDto>;

export const NodeModelDto = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string().nullable(),
  format: z.enum(ModelFormat),
  type: z.enum(ModelType),
  quantisation: z.string().nullable(),
  quantisationMixed: z.boolean(),
  sizeBytes: z.number(),
  /** This node's own path to the model, and the first shard where it is sharded. */
  path: z.string(),
  lastConfirmedDate: timestamp(),
});
export type NodeModelDto = z.infer<typeof NodeModelDto>;

export const NodeModelInventoryResponseDto = z.object({
  /** What the node's last scan found, ordered by label. */
  models: z.array(NodeModelDto),
});
export type NodeModelInventoryResponseDto = z.infer<typeof NodeModelInventoryResponseDto>;
