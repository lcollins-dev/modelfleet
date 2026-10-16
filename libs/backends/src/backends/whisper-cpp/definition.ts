import { BackendId } from '../../backend-id';
import {
  BackendOperation,
  DEFINITION_FORMAT_VERSION,
  DevicePresentation,
  BackendDefinition,
  ProbeMethod,
  StreamDialect,
  VramSource,
} from '../../definition';
import { WHISPER_CPP_IMAGES, whisperCppDeclaration } from './declaration';

const MIB = 1024 * 1024;

const SHARED_MEMORY_BYTES = 64 * MIB;

export const whisperCppDefinition: BackendDefinition = {
  id: BackendId.WHISPER_CPP,
  formatVersion: DEFINITION_FORMAT_VERSION,

  images: WHISPER_CPP_IMAGES,

  // The image's own entrypoint is `bash -c`, which would read the arguments as one shell string.
  entrypoint: ['whisper-server'],

  argv: [
    ['--model', '{{model_path}}'],

    // whisper-server binds loopback by default, which nothing outside the container can reach.
    ['--host', '0.0.0.0'],
    ['--port', '{{port}}'],

    // It serves `/inference` by default.
    ['--inference-path', '/v1/audio/transcriptions'],

    // Without conversion it reads 16 kHz WAV alone, and it writes converted files into its working directory.
    ['--convert'],
    ['--tmp-dir', '/tmp'],
  ],

  launchModeArgv: {},
  environment: {},
  port: 8080,
  modelMount: '/models',

  container: {
    multiDevice: false,
    cpuOffload: false,
    devicePresentation: DevicePresentation.DEVICE_REQUEST,
    stopGraceSeconds: 10,
    sharedMemoryBytes: SHARED_MEMORY_BYTES,
  },

  // whisper-server answers `/health` with 503 until the model is loaded.
  readiness: {
    probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200], body: { path: 'status', equals: 'ok' } },
  },

  declaration: whisperCppDeclaration,

  // Translation is a `translate` form field on the same path rather than a route of its own, so it is not served.
  operations: {
    [BackendOperation.TRANSCRIPTION]: {
      path: '/v1/audio/transcriptions',
      responseFormats: ['json', 'text', 'verbose_json', 'srt', 'vtt'],
      streaming: StreamDialect.NONE,
    },
  },

  // Fitted to faster-whisper's 4.5 GB for Whisper large at fp16, whose ggml file is 3.1 GB.
  vram: { estimate: { source: VramSource.WEIGHTS, factor: 1.2, overheadBytesPerDevice: 768 * MIB } },
};
