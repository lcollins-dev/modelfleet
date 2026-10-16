import { z } from 'zod';

import { Usage } from './common';

export const EMBEDDING_LIST_OBJECT = 'list';
export const EMBEDDING_OBJECT = 'embedding';

export const EmbeddingRequest = z.looseObject({
  /** The deployment the gateway routes on, not the weights. */
  model: z.string().min(1),

  /** Text, a batch of texts, or either already tokenised. */
  input: z.union([z.string(), z.array(z.string()), z.array(z.number().int()), z.array(z.array(z.number().int()))]),

  encoding_format: z.string().optional(),
  dimensions: z.number().int().nullish(),
  user: z.string().optional(),
});
export type EmbeddingRequest = z.infer<typeof EmbeddingRequest>;

export const Embedding = z.looseObject({
  object: z.string(),
  index: z.number().int().nonnegative(),

  /** Floats, or a base64 string where the request asked for that encoding. */
  embedding: z.union([z.array(z.number()), z.string()]),
});
export type Embedding = z.infer<typeof Embedding>;

export const EmbeddingResponse = z.looseObject({
  object: z.string(),
  data: z.array(Embedding),
  model: z.string(),
  usage: Usage.nullish(),
});
export type EmbeddingResponse = z.infer<typeof EmbeddingResponse>;
