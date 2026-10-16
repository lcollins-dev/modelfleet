import { BackendOperation } from '../definition';
import { IChatCompletionsMapping, IEmbeddingsMapping, ISpeechMapping, ITranscriptionMapping } from './mapping';
import { VramSizingHook } from './sizing';

export enum HookKind {
  SIZING = 'sizing',
  MAPPING = 'mapping',
}

export interface ISizingHook {
  kind: HookKind.SIZING;
  size: VramSizingHook;
}

export interface IChatCompletionsHook {
  kind: HookKind.MAPPING;
  operation: BackendOperation.CHAT_COMPLETIONS;
  mapping: IChatCompletionsMapping;
}

export interface IEmbeddingsHook {
  kind: HookKind.MAPPING;
  operation: BackendOperation.EMBEDDINGS;
  mapping: IEmbeddingsMapping;
}

export interface ITranscriptionHook {
  kind: HookKind.MAPPING;
  operation: BackendOperation.TRANSCRIPTION;
  mapping: ITranscriptionMapping;
}

export interface ISpeechHook {
  kind: HookKind.MAPPING;
  operation: BackendOperation.SPEECH;
  mapping: ISpeechMapping;
}

export type MappingHook = IChatCompletionsHook | IEmbeddingsHook | ITranscriptionHook | ISpeechHook;

export type BackendHook = ISizingHook | MappingHook;

export type HookRegistry = ReadonlyMap<string, BackendHook>;
