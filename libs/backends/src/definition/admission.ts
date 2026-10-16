import { BackendConfiguration, IMAGE_FIELD, configuredText, servesFormat } from '../configuration';
import { IInstancePins, LaunchMode, launchModeOf } from '../launch';
import { ModelFormat, ModelTask, ProjectorModality } from '../model';
import { ContainerSettings } from './container';
import { BackendDefinition } from './definition';
import { imageVariantOf } from './image';
import { BackendOperation } from './operation';
import { unlistedStages } from './vram';

export enum ModelRefusal {
  FORMAT_NOT_SERVED = 'formatNotServed',
  STAGES_UNLISTED = 'stagesUnlisted',
}

export enum PinsRefusal {
  SEVERAL_DEVICES = 'severalDevices',
  CPU_BESIDE_DEVICES = 'cpuBesideDevices',
}

export interface IAdmittedModel {
  format: ModelFormat;
  architecture: string | null;
}

const TASK_ADMITS: Readonly<Record<ModelTask, readonly BackendOperation[]>> = {
  [ModelTask.CHAT]: [BackendOperation.CHAT_COMPLETIONS],
  [ModelTask.EMBEDDING]: [BackendOperation.EMBEDDINGS],
  [ModelTask.TRANSCRIPTION]: [BackendOperation.TRANSCRIPTION, BackendOperation.TRANSLATION],
  [ModelTask.SPEECH]: [BackendOperation.SPEECH],
};

const PROJECTOR_TASKS: Readonly<Record<ProjectorModality, readonly ModelTask[]>> = {
  [ProjectorModality.VISION]: [],
  [ProjectorModality.AUDIO]: [ModelTask.TRANSCRIPTION],
};

export function modelRefusals(definition: BackendDefinition, model: IAdmittedModel): ModelRefusal[] {
  const refusals: ModelRefusal[] = [];

  if (!servesFormat(definition.declaration, model.format)) {
    refusals.push(ModelRefusal.FORMAT_NOT_SERVED);
  }

  if (unlistedStages(definition.vram, model.architecture)) {
    refusals.push(ModelRefusal.STAGES_UNLISTED);
  }

  return refusals;
}

export function pinsRefusal(container: ContainerSettings, pins: IInstancePins): PinsRefusal | null {
  if (pins.gpus.length > 1 && !container.multiDevice) {
    return PinsRefusal.SEVERAL_DEVICES;
  }

  return launchModeOf(pins) === LaunchMode.CPU_OFFLOAD && !container.cpuOffload ? PinsRefusal.CPU_BESIDE_DEVICES : null;
}

export function tasksAdmit(
  tasks: readonly ModelTask[],
  operation: BackendOperation,
  projectors: readonly ProjectorModality[] = []
): boolean {
  if (tasks.length === 0) {
    return true;
  }

  const held = [...tasks, ...projectors.flatMap(modality => PROJECTOR_TASKS[modality])];

  return held.some(task => TASK_ADMITS[task].includes(operation));
}

export function resolveImage(
  definition: BackendDefinition,
  configuration: BackendConfiguration,
  pins: IInstancePins
): string | null {
  const configured = configuredText(definition.declaration, configuration, IMAGE_FIELD);

  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  return definition.images[imageVariantOf(pins)] ?? null;
}
