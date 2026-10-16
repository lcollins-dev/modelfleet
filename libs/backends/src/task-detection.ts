import { ModelTask } from './model';

/*
 * The first source to answer decides. A directory model reads ARCHITECTURE_TASKS, the card's pipeline tag,
 * FILE_TASKS, the architecture suffixes, the config keys, then the model type. A GGUF reads its pooling type, its
 * architecture, then the presence of `tokenizer.chat_template`.
 */

const CHAT: readonly ModelTask[] = [ModelTask.CHAT];
const EMBEDDING: readonly ModelTask[] = [ModelTask.EMBEDDING];
const TRANSCRIPTION: readonly ModelTask[] = [ModelTask.TRANSCRIPTION];
const SPEECH: readonly ModelTask[] = [ModelTask.SPEECH];
const HEARING_CHAT: readonly ModelTask[] = [ModelTask.CHAT, ModelTask.TRANSCRIPTION];
const OMNI: readonly ModelTask[] = [ModelTask.CHAT, ModelTask.TRANSCRIPTION, ModelTask.SPEECH];

export const ARCHITECTURE_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([
  ['WhisperForConditionalGeneration', TRANSCRIPTION],
  ['Speech2TextForConditionalGeneration', TRANSCRIPTION],
  ['MoonshineForConditionalGeneration', TRANSCRIPTION],
  ['GraniteSpeechForConditionalGeneration', TRANSCRIPTION],
  ['Wav2Vec2ForCTC', TRANSCRIPTION],
  ['HubertForCTC', TRANSCRIPTION],
  ['WavLMForCTC', TRANSCRIPTION],
  ['VitsModel', SPEECH],
  ['SpeechT5ForTextToSpeech', SPEECH],
  ['BarkModel', SPEECH],
  ['Qwen3TTSForConditionalGeneration', SPEECH],
  ['Qwen2AudioForConditionalGeneration', HEARING_CHAT],
  ['VoxtralForConditionalGeneration', HEARING_CHAT],
  ['Gemma3nForConditionalGeneration', HEARING_CHAT],
  ['Phi4MMForCausalLM', HEARING_CHAT],
  ['Qwen2_5OmniModel', OMNI],
  ['Qwen2_5OmniForConditionalGeneration', OMNI],
  ['Qwen3OmniMoeForConditionalGeneration', OMNI],
]);

export const PIPELINE_TAG_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([
  ['automatic-speech-recognition', TRANSCRIPTION],
  ['text-to-speech', SPEECH],
  ['text-to-audio', SPEECH],
  ['text-generation', CHAT],
  ['image-text-to-text', CHAT],
  ['audio-text-to-text', HEARING_CHAT],
  ['feature-extraction', EMBEDDING],
  ['sentence-similarity', EMBEDDING],
]);

export const FILE_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([
  ['modules.json', EMBEDDING],
  ['config_sentence_transformers.json', EMBEDDING],
]);

export const ARCHITECTURE_SUFFIX_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([['ForCausalLM', CHAT]]);

/** Answers where the config holds every key as an object. */
export const CONFIG_KEY_TASKS: readonly { keys: readonly string[]; tasks: readonly ModelTask[] }[] = [
  { keys: ['istftnet', 'plbert'], tasks: SPEECH },
];

export const MODEL_TYPE_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([
  ['whisper', TRANSCRIPTION],
  ['moonshine', TRANSCRIPTION],
  ['granite_speech', TRANSCRIPTION],
  ['vits', SPEECH],
  ['bark', SPEECH],
]);

/** llama.cpp's numbering: mean, CLS and last token, then rank, a reranker no task describes. */
export const GGUF_POOLING_TYPE_TASKS: ReadonlyMap<number, readonly ModelTask[]> = new Map([
  [1, EMBEDDING],
  [2, EMBEDDING],
  [3, EMBEDDING],
  [4, []],
]);

export const GGUF_ARCHITECTURE_TASKS: ReadonlyMap<string, readonly ModelTask[]> = new Map([
  ['bert', EMBEDDING],
  ['nomic-bert', EMBEDDING],
  ['nomic-bert-moe', EMBEDDING],
  ['jina-bert-v2', EMBEDDING],
  ['jina-bert-v3', EMBEDDING],
  ['neo-bert', EMBEDDING],
  ['modern-bert', EMBEDDING],
  ['t5encoder', EMBEDDING],
]);

export const GGUF_CHAT_TEMPLATE_TASKS: readonly ModelTask[] = CHAT;
