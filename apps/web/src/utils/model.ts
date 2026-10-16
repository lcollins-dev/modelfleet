import {
  ModelLicenceDto,
  LicenceTerms,
  ModelFormat,
  ModelState,
  ModelTask,
  ModelTaskFilter,
  ModelType,
  ProjectorModality,
  UNKNOWN_MODEL_TASK,
} from '@libs/dto';

export type ModelStateTone = 'success' | 'error';

export interface ILicenceMark {
  label: string;
  tone: 'warning' | 'default';
}

export interface IModelKind {
  format: ModelFormat;
  quantisation: string | null;
  quantisationMixed: boolean;
}

const FORMAT_LABELS: Record<ModelFormat, string> = {
  [ModelFormat.GGUF]: 'GGUF',
  [ModelFormat.SAFETENSORS]: 'safetensors',
  [ModelFormat.GGML]: 'ggml',
  [ModelFormat.PYTORCH]: 'PyTorch',
};

const TYPE_LABELS: Record<ModelType, string> = {
  [ModelType.MODEL]: 'Model',
  [ModelType.PROJECTOR]: 'Projector',
  [ModelType.LORA]: 'LoRA adapter',
  [ModelType.CONTROL_VECTOR]: 'Control vector',
};

const TASK_LABELS: Record<ModelTaskFilter, string> = {
  [ModelTask.CHAT]: 'Chat',
  [ModelTask.EMBEDDING]: 'Embedding',
  [ModelTask.TRANSCRIPTION]: 'Transcription',
  [ModelTask.SPEECH]: 'Speech',
  [UNKNOWN_MODEL_TASK]: 'Unknown task',
};

const LICENCE_MARKS: Record<LicenceTerms, ILicenceMark> = {
  [LicenceTerms.NON_COMMERCIAL]: { label: 'Non-commercial', tone: 'warning' },
  [LicenceTerms.CUSTOM]: { label: 'Custom licence', tone: 'default' },
};

const MODALITY_LABELS: Record<ProjectorModality, string> = {
  [ProjectorModality.VISION]: 'vision',
  [ProjectorModality.AUDIO]: 'audio',
};

const STATE_LABELS: Record<ModelState, string> = {
  [ModelState.AVAILABLE]: 'Available',
  [ModelState.UNAVAILABLE]: 'Unavailable',
};

const STATE_TONES: Record<ModelState, ModelStateTone> = {
  [ModelState.AVAILABLE]: 'success',
  [ModelState.UNAVAILABLE]: 'error',
};

export const modelLabel = (model: { name: string; displayName: string | null }): string =>
  model.displayName ?? model.name;

export const formatModelType = (type: ModelType): string => TYPE_LABELS[type];

export const companionLabel = (type: ModelType): string | null => (type === ModelType.MODEL ? null : TYPE_LABELS[type]);

export const formatModelTask = (task: ModelTaskFilter): string => TASK_LABELS[task];

export const sortModelTasks = (tasks: readonly ModelTask[]): ModelTask[] =>
  Object.values(ModelTask).filter(task => tasks.includes(task));

export const formatModelTasks = (tasks: readonly ModelTask[]): string =>
  tasks.length === 0
    ? TASK_LABELS[UNKNOWN_MODEL_TASK]
    : sortModelTasks(tasks)
        .map(task => TASK_LABELS[task])
        .join(', ');

export const licenceMark = (licence: ModelLicenceDto | null): ILicenceMark | null =>
  licence === null || licence.terms === null ? null : LICENCE_MARKS[licence.terms];

export const formatModalities = (modalities: readonly ProjectorModality[]): string =>
  modalities.map(modality => MODALITY_LABELS[modality]).join(' and ');

export const formatModelState = (state: ModelState): string => STATE_LABELS[state];

export const modelStateTone = (state: ModelState): ModelStateTone => STATE_TONES[state];

export const formatModelKind = (model: IModelKind): string => {
  if (model.quantisation === null) {
    return FORMAT_LABELS[model.format];
  }

  const quantisation = model.quantisationMixed ? `mostly ${model.quantisation}` : model.quantisation;

  return `${FORMAT_LABELS[model.format]} ${quantisation}`;
};

/** Null where no node holds the file any more. */
export const modelFileName = (model: { availability: readonly { path: string }[] }): string | null => {
  const path = model.availability[0]?.path ?? '';
  const name = path.split('/').pop() ?? '';

  return name.length > 0 ? name : null;
};
