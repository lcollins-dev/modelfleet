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
import { KOKORO_IMAGES, kokoroDeclaration } from './declaration';

const MIB = 1024 * 1024;

const SHARED_MEMORY_BYTES = 64 * MIB;

const MODEL_MOUNT = '/models';

export const kokoroDefinition: BackendDefinition = {
  id: BackendId.KOKORO,
  formatVersion: DEFINITION_FORMAT_VERSION,

  images: KOKORO_IMAGES,

  entrypoint: ['/app/entrypoint.sh'],
  argv: [],
  launchModeArgv: {},

  environment: {
    // Kokoro-FastAPI loads `v1_0/kokoro-v1_0.pth` and the `config.json` beside it from this directory.
    MODEL_DIR: MODEL_MOUNT,

    // Otherwise the script fetches the weights into the image's own directory before every start.
    DOWNLOAD_MODEL: 'false',

    // Unloading on idle would free memory the ledger still holds against the card.
    MODEL_AUTO_UNLOAD_TIMEOUT_SECONDS: '0',

    PORT: '{{port}}',
  },

  port: 8880,
  modelMount: MODEL_MOUNT,
  weightsName: 'v1_0',

  container: {
    multiDevice: false,
    cpuOffload: false,
    devicePresentation: DevicePresentation.DEVICE_REQUEST,
    stopGraceSeconds: 10,
    sharedMemoryBytes: SHARED_MEMORY_BYTES,
  },

  // The port opens only once the model is loaded and warmed up.
  readiness: {
    probe: {
      method: ProbeMethod.GET,
      path: '/health',
      passStatuses: [200],
      body: { path: 'status', equals: 'healthy' },
    },
  },

  declaration: kokoroDeclaration,

  operations: {
    // Its `stream` sends raw audio in chunks rather than OpenAI's events, which a byte relay carries as it is.
    [BackendOperation.SPEECH]: {
      path: '/v1/audio/speech',
      responseFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
      streaming: StreamDialect.NONE,

      // It refuses any model name outside a list built into the image.
      upstreamModel: 'kokoro',

      voices: { path: '/v1/audio/voices', list: 'voices' },
    },
  },

  // Kokoro-FastAPI publishes a 2.4 GB floor and a 3-4 GB peak for its 327 MB checkpoint.
  vram: { estimate: { source: VramSource.WEIGHTS, factor: 1, overheadBytesPerDevice: 3 * GIB } },
};
