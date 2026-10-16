import { BackendOperation } from '../../definition';
import { BackendHook, HookKind, HookRegistry } from '../../runtime/hooks';
import { LlamaCppHook } from './definition';
import { llamaCppChatCompletions, llamaCppEmbeddings, llamaCppTranscription } from './mapping';
import { llamaCppSizeVram } from './sizing';

export const llamaCppHooks: HookRegistry = new Map<string, BackendHook>([
  [LlamaCppHook.VRAM, { kind: HookKind.SIZING, size: llamaCppSizeVram }],
  [
    LlamaCppHook.CHAT_COMPLETIONS,
    { kind: HookKind.MAPPING, operation: BackendOperation.CHAT_COMPLETIONS, mapping: llamaCppChatCompletions },
  ],
  [
    LlamaCppHook.EMBEDDINGS,
    { kind: HookKind.MAPPING, operation: BackendOperation.EMBEDDINGS, mapping: llamaCppEmbeddings },
  ],
  [
    LlamaCppHook.TRANSCRIPTION,
    { kind: HookKind.MAPPING, operation: BackendOperation.TRANSCRIPTION, mapping: llamaCppTranscription },
  ],
]);
