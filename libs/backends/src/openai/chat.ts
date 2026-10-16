import { z } from 'zod';

import { Usage } from './common';

export const CHAT_COMPLETION_OBJECT = 'chat.completion';
export const CHAT_COMPLETION_CHUNK_OBJECT = 'chat.completion.chunk';

/** OpenAI's own roles. A request naming another is relayed rather than refused, so this is not a closed set. */
export enum ChatRole {
  SYSTEM = 'system',
  DEVELOPER = 'developer',
  USER = 'user',
  ASSISTANT = 'assistant',
  TOOL = 'tool',
}

export const ChatToolCall = z.looseObject({
  id: z.string().optional(),

  /** Present on a streamed chunk, where a call is assembled across deltas. */
  index: z.number().int().nonnegative().optional(),

  type: z.string().optional(),
  function: z
    .looseObject({
      name: z.string().optional(),
      arguments: z.string().optional(),
    })
    .optional(),
});
export type ChatToolCall = z.infer<typeof ChatToolCall>;

export const ChatMessage = z.looseObject({
  role: z.string().min(1),

  /** Text, or OpenAI's content parts. Parts are carried as written, since only the backend reads them. */
  content: z.union([z.string(), z.array(z.looseObject({ type: z.string() })), z.null()]).optional(),

  name: z.string().optional(),
  tool_calls: z.array(ChatToolCall).optional(),
  tool_call_id: z.string().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const ChatCompletionRequest = z.looseObject({
  /** The deployment the gateway routes on, not the weights. */
  model: z.string().min(1),

  messages: z.array(ChatMessage).min(1),

  stream: z.boolean().optional(),
  stream_options: z.looseObject({ include_usage: z.boolean().optional() }).nullish(),

  max_tokens: z.number().int().nullish(),
  max_completion_tokens: z.number().int().nullish(),
  temperature: z.number().nullish(),
  top_p: z.number().nullish(),
  n: z.number().int().nullish(),
  stop: z.union([z.string(), z.array(z.string()), z.null()]).optional(),
  seed: z.number().int().nullish(),
  presence_penalty: z.number().nullish(),
  frequency_penalty: z.number().nullish(),
  logprobs: z.boolean().nullish(),
  top_logprobs: z.number().int().nullish(),

  response_format: z.looseObject({ type: z.string() }).nullish(),
  tools: z.array(z.looseObject({ type: z.string() })).optional(),
  tool_choice: z.union([z.string(), z.looseObject({ type: z.string() }), z.null()]).optional(),

  user: z.string().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequest>;

export const ChatCompletionChoice = z.looseObject({
  index: z.number().int().nonnegative(),
  message: ChatMessage,
  finish_reason: z.string().nullish(),
});
export type ChatCompletionChoice = z.infer<typeof ChatCompletionChoice>;

export const ChatCompletionResponse = z.looseObject({
  id: z.string(),
  object: z.string(),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChatCompletionChoice),
  usage: Usage.nullish(),
});
export type ChatCompletionResponse = z.infer<typeof ChatCompletionResponse>;

export const ChatCompletionDelta = z.looseObject({
  role: z.string().optional(),
  content: z.string().nullish(),
  tool_calls: z.array(ChatToolCall).optional(),
});
export type ChatCompletionDelta = z.infer<typeof ChatCompletionDelta>;

export const ChatCompletionChunkChoice = z.looseObject({
  index: z.number().int().nonnegative(),
  delta: ChatCompletionDelta,
  finish_reason: z.string().nullish(),
});
export type ChatCompletionChunkChoice = z.infer<typeof ChatCompletionChunkChoice>;

export const ChatCompletionChunk = z.looseObject({
  id: z.string(),
  object: z.string(),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChatCompletionChunkChoice),

  /** Only on the final chunk, and only where the request asked for it. */
  usage: Usage.nullish(),
});
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunk>;
