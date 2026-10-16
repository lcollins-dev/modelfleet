export enum ModelType {
  MODEL = 'model',
  PROJECTOR = 'projector',
  LORA = 'lora',
  CONTROL_VECTOR = 'control-vector',
}

export enum ModelFormat {
  GGUF = 'gguf',
  SAFETENSORS = 'safetensors',

  GGML = 'ggml',

  PYTORCH = 'pytorch',
}

export enum ModelTask {
  CHAT = 'chat',
  EMBEDDING = 'embedding',
  TRANSCRIPTION = 'transcription',
  SPEECH = 'speech',
}

export enum ProjectorModality {
  VISION = 'vision',
  AUDIO = 'audio',
}

export const MODEL_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
