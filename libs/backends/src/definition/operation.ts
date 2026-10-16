import { z } from 'zod';

import { VoiceListing } from './voices';

export enum BackendOperation {
  CHAT_COMPLETIONS = 'chatCompletions',
  EMBEDDINGS = 'embeddings',
  TRANSCRIPTION = 'transcription',
  TRANSLATION = 'translation',
  SPEECH = 'speech',
}

/** A backend whose stream deviates from OpenAI's declares `NONE`, since nothing maps another dialect. */
export enum StreamDialect {
  NONE = 'none',
  OPENAI = 'openai',
}

export const OperationDefinition = z.strictObject({
  path: z.string().regex(/^\//, { error: 'must start with /' }),

  /** Null accepts any. */
  responseFormats: z.array(z.string().min(1)).nullable(),

  streaming: z.enum(StreamDialect),

  /** A mapping hook's name. Absent relays the operation as bytes both ways. */
  mapping: z.string().min(1).optional(),

  /** Replaces the request's `model`. A multipart operation takes none. */
  upstreamModel: z.string().min(1).optional(),

  /** Speech alone. */
  voices: VoiceListing.optional(),
});

export type OperationDefinition = z.infer<typeof OperationDefinition>;

export const OperationDefinitions = z.partialRecord(z.enum(BackendOperation), OperationDefinition);

export type OperationDefinitions = z.infer<typeof OperationDefinitions>;

export const MULTIPART_OPERATIONS: readonly BackendOperation[] = [
  BackendOperation.TRANSCRIPTION,
  BackendOperation.TRANSLATION,
];
