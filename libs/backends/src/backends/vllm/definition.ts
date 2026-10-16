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
import { GPU_MEMORY_UTILIZATION_FIELD, VLLM_IMAGES, vllmDeclaration } from './declaration';

/** vLLM refuses `srt` and `vtt`, and answers `text` with its JSON body. Its own `diarized_json` no client asks for. */
const RESPONSE_FORMATS = ['json', 'text', 'verbose_json'];

/** Tensor parallelism moves activations over NCCL, whose transport buffers live in `/dev/shm`. */
const SHARED_MEMORY_BYTES = GIB;

export const vllmDefinition: BackendDefinition = {
  id: BackendId.VLLM,
  formatVersion: DEFINITION_FORMAT_VERSION,

  images: VLLM_IMAGES,

  argv: [
    ['{{model_path}}'],
    ['--served-model-name', '{{served_model}}'],
    ['--host', '0.0.0.0'],
    ['--port', '{{port}}'],
    ['--tensor-parallel-size', '{{gpu_count}}'],
  ],

  launchModeArgv: {},

  // A missing tokenizer or processor fails the launch rather than downloading behind the catalogue.
  environment: {
    HF_HUB_OFFLINE: '1',
    VLLM_NO_USAGE_STATS: '1',
    DO_NOT_TRACK: '1',
  },

  port: 8000,
  modelMount: '/models',

  container: {
    multiDevice: true,

    // No launch mode hands part of the model to host memory, so a CPU pinned beside a card would hold nothing.
    cpuOffload: false,
    devicePresentation: DevicePresentation.DEVICE_REQUEST,
    stopGraceSeconds: 30,
    sharedMemoryBytes: SHARED_MEMORY_BYTES,
  },

  // vLLM binds only once the engine is up, and compiles and captures CUDA graphs first whatever the model's size.
  readiness: {
    probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200] },
    startTimeoutSeconds: 600,
  },

  declaration: vllmDeclaration,

  // vLLM streams a transcription as chat-shaped chunks, not OpenAI's transcript events.
  operations: {
    [BackendOperation.TRANSCRIPTION]: {
      path: '/v1/audio/transcriptions',
      responseFormats: RESPONSE_FORMATS,
      streaming: StreamDialect.NONE,
    },
    [BackendOperation.TRANSLATION]: {
      path: '/v1/audio/translations',
      responseFormats: RESPONSE_FORMATS,
      streaming: StreamDialect.NONE,
    },
  },

  vram: { estimate: { source: VramSource.CONFIGURATION, fractionField: GPU_MEMORY_UTILIZATION_FIELD } },
};
