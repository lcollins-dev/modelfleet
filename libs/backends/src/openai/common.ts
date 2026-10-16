import { z } from 'zod';

/** The line a streamed response ends with, in place of a JSON chunk. */
export const STREAM_DONE = '[DONE]';

export const Usage = z.looseObject({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;
