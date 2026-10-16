import { BackendId } from '../../backend-id';
import {
  BackendOperation,
  DEFINITION_FORMAT_VERSION,
  DevicePresentation,
  GIB,
  ArchitectureStages,
  BackendDefinition,
  ProbeMethod,
  StreamDialect,
  VramLaunchKind,
  VramSource,
} from '../../definition';
import { GPU_MEMORY_GIB_FIELD, VLLM_OMNI_IMAGES, vllmOmniDeclaration } from './declaration';

const SHARED_MEMORY_BYTES = GIB;

/** Transcribed from the image's own default deploy configs, so it is regenerated with every image bump (RES-0003). */
const STAGES: ArchitectureStages[] = [
  { architecture: 'arktts', shares: [0.2, 0.1] },
  { architecture: 'audex_s2s', shares: [0.5, 0.25] },
  { architecture: 'audex_thinker_only', shares: [0.7] },
  { architecture: 'audex_tta', shares: [0.4, 0.25] },
  { architecture: 'audex_tts', shares: [0.4, 0.25] },
  { architecture: 'auk', shares: [0.45, 0.35] },
  { architecture: 'aura_omni', shares: [0.1, 0.4, 0.2, 0.2] },
  { architecture: 'breeze', shares: [0.65, 0.15] },
  { architecture: 'cosyvoice3', shares: [0.4, 0.2] },
  { architecture: 'covo_audio', shares: [0.5, 0.2] },
  { architecture: 'fish_qwen3_omni', shares: [0.6, 0.1] },
  { architecture: 'gepard', shares: [0.3] },
  { architecture: 'glm_tts', shares: [0.55, 0.25] },
  { architecture: 'higgs_audio_v2', shares: [0.6, 0.25] },
  { architecture: 'higgs_multimodal_qwen3', shares: [0.6, 0.25] },
  { architecture: 'indextts2', shares: [0.4, 0.4] },
  { architecture: 'indextts2_5', shares: [0.4, 0.4] },
  { architecture: 'joyai_vl_interaction', shares: [0.5, 0.2, 0.2] },
  { architecture: 'mammoth_moda2', shares: [0.5, 0.3] },
  { architecture: 'mammoth_moda2_ar', shares: [0.5] },
  { architecture: 'mimo_audio', shares: [0.5, 0.3] },
  { architecture: 'ming_flash_omni_tts', shares: [0.8] },
  { architecture: 'ming_tts', shares: [0.45, 0.25] },
  { architecture: 'ming_tts_moe', shares: [0.6, 0.25] },
  { architecture: 'minimax_music3', shares: [0.6, 0.2] },
  { architecture: 'moss_tts_delay', shares: [0.85, 0.12] },
  { architecture: 'moss_tts_local', shares: [0.6, 0.3] },
  { architecture: 'moss_tts_nano', shares: [0.3] },
  { architecture: 'moss_tts_realtime', shares: [0.6, 0.12] },
  { architecture: 'nemotron_labs_audex', shares: [0.4, 0.25] },
  { architecture: 'nemotron_labs_voicechat', shares: [0.62, 0.12, 0.06] },
  { architecture: 'nemotron_voicechat', shares: [0.62, 0.12, 0.06] },
  { architecture: 'personaplex', shares: [0.4, 0.3] },
  { architecture: 'qwen3_tts', shares: [0.3, 0.3] },
  { architecture: 'voxcpm2', shares: [0.9] },
  { architecture: 'voxtral_tts', shares: [0.8, 0.1] },
];

export const vllmOmniDefinition: BackendDefinition = {
  id: BackendId.VLLM_OMNI,
  formatVersion: DEFINITION_FORMAT_VERSION,

  images: VLLM_OMNI_IMAGES,

  // The image clears vLLM's entrypoint.
  entrypoint: ['vllm', 'serve'],

  argv: [
    ['{{model_path}}'],
    ['--omni'],
    ['--served-model-name', '{{served_model}}'],
    ['--host', '0.0.0.0'],
    ['--port', '{{port}}'],
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
    // Every stage of the bundled pipelines runs on the first card the container sees.
    multiDevice: false,
    cpuOffload: false,
    devicePresentation: DevicePresentation.DEVICE_REQUEST,
    stopGraceSeconds: 30,
    sharedMemoryBytes: SHARED_MEMORY_BYTES,
  },

  // It listens once every stage is up, allowing each up to 300 seconds, and compiles before it serves.
  readiness: {
    probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200] },
    startTimeoutSeconds: 900,
  },

  declaration: vllmOmniDeclaration,

  operations: {
    [BackendOperation.SPEECH]: {
      path: '/v1/audio/speech',
      responseFormats: ['wav', 'pcm', 'flac', 'mp3', 'opus'],
      streaming: StreamDialect.OPENAI,
      voices: { path: '/v1/audio/voices', list: 'voices' },
    },
  },

  // `model_type` picks the entry.
  vram: {
    estimate: { source: VramSource.SIZE, gibField: GPU_MEMORY_GIB_FIELD },
    launch: {
      kind: VramLaunchKind.STAGE_SHARES,
      flag: '--stage-overrides',
      shareKey: 'gpu_memory_utilization',
      architectures: STAGES,
    },
  },
};
