import { z } from 'zod';

export const MODEL_OBJECT = 'model';
export const MODEL_LIST_OBJECT = 'list';

export const modelSchema = z.looseObject({
  /** The deployment name a caller sends as `model`. */
  id: z.string(),

  object: z.string(),
  created: z.number().int(),
  owned_by: z.string(),
});
export type Model = z.infer<typeof modelSchema>;

export const modelListSchema = z.looseObject({
  object: z.string(),
  data: z.array(modelSchema),
});
export type ModelList = z.infer<typeof modelListSchema>;
