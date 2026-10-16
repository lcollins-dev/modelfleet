import { z } from 'zod';

export const SpeechRequest = z.looseObject({
  /** The deployment the gateway routes on, not the weights. */
  model: z.string().min(1),

  input: z.string(),
  voice: z.unknown().optional(),
  response_format: z.string().optional(),

  /** `sse` streams OpenAI's events; `audio`, the default, streams the bytes alone. */
  stream_format: z.string().optional(),
});
export type SpeechRequest = z.infer<typeof SpeechRequest>;

export const SPEECH_STREAM_FORMAT_SSE = 'sse';

export const TranscriptionResponse = z.looseObject({
  text: z.string(),
});
export type TranscriptionResponse = z.infer<typeof TranscriptionResponse>;
