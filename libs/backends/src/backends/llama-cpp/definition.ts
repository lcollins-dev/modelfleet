import { BackendId } from '../../backend-id';
import {
  BackendOperation,
  DEFINITION_FORMAT_VERSION,
  DevicePresentation,
  GIB,
  BackendDefinition,
  ProbeMethod,
  StreamDialect,
  VramSource,
} from '../../definition';
import { LLAMA_CPP_IMAGES, llamaCppDeclaration } from './declaration';

/** Named here rather than beside the hooks, so the browser can read the definition without them. */
export enum LlamaCppHook {
  VRAM = 'llama.cpp/vram',
  CHAT_COMPLETIONS = 'llama.cpp/chat-completions',
  EMBEDDINGS = 'llama.cpp/embeddings',
  TRANSCRIPTION = 'llama.cpp/transcription',
}

/** NCCL's transport buffers live in `/dev/shm` and outgrow Docker's 64 MB default under tensor split. */
const SHARED_MEMORY_BYTES = GIB;

export const llamaCppDefinition: BackendDefinition = {
  id: BackendId.LLAMA_CPP,
  formatVersion: DEFINITION_FORMAT_VERSION,

  images: LLAMA_CPP_IMAGES,

  argv: [
    ['--model', '{{model_path}}'],
    ['--alias', '{{served_model}}'],

    // llama-server binds loopback by default, which nothing outside the container can reach.
    ['--host', '0.0.0.0'],
    ['--port', '{{port}}'],
  ],

  launchModeArgv: {},

  environment: {},
  port: 8080,
  modelMount: '/models',

  container: {
    multiDevice: true,
    cpuOffload: true,
    devicePresentation: DevicePresentation.DEVICE_REQUEST,

    // llama.cpp's main GPU and `--tensor-split` are read in device order, which the operator chose in pin order.
    pinOrderedDevices: true,
    stopGraceSeconds: 30,
    sharedMemoryBytes: SHARED_MEMORY_BYTES,
  },

  // llama-server answers `/health` with 503 and `Loading model` until the weights are in and a slot is free.
  readiness: {
    probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200], body: { path: 'status', equals: 'ok' } },
  },

  declaration: llamaCppDeclaration,

  operations: {
    [BackendOperation.CHAT_COMPLETIONS]: {
      path: '/v1/chat/completions',
      responseFormats: null,
      streaming: StreamDialect.OPENAI,
      mapping: LlamaCppHook.CHAT_COMPLETIONS,
    },
    [BackendOperation.EMBEDDINGS]: {
      path: '/v1/embeddings',
      responseFormats: null,
      streaming: StreamDialect.NONE,
      mapping: LlamaCppHook.EMBEDDINGS,
    },

    // llama-server answers an audio GGUF loaded with its projector, and writes `json` alone (llama.cpp #21863).
    [BackendOperation.TRANSCRIPTION]: {
      path: '/v1/audio/transcriptions',
      responseFormats: ['json'],
      streaming: StreamDialect.NONE,
      mapping: LlamaCppHook.TRANSCRIPTION,
    },
  },

  vram: { estimate: { source: VramSource.HOOK, hook: LlamaCppHook.VRAM } },
};
