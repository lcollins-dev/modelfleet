import { ModelFormat, ModelType } from '@libs/agent-protocol';
import { BackendId, definitionFor, ModelRefusal, modelRefusals, unlistedStagesMessage } from '@libs/backends';

import { Model } from './entities/model.entity';

const NOT_A_MODEL_MESSAGES: Record<Exclude<ModelType, ModelType.MODEL>, string> = {
  [ModelType.PROJECTOR]: 'A multimodal projector runs alongside a model. It cannot be deployed on its own',
  [ModelType.LORA]: 'A LoRA adapter runs alongside the model it adapts. It cannot be deployed on its own',
  [ModelType.CONTROL_VECTOR]: 'A control vector runs alongside a model. It cannot be deployed on its own',
};

/** Null where the weights can be served alone. Otherwise the reason, naming what the file is. */
export const servableProblem = (model: Model): string | null =>
  model.type === ModelType.MODEL ? null : NOT_A_MODEL_MESSAGES[model.type];

const FORMAT_LABELS: Record<ModelFormat, string> = {
  [ModelFormat.GGUF]: 'GGUF',
  [ModelFormat.SAFETENSORS]: 'safetensors',
  [ModelFormat.GGML]: 'ggml',
  [ModelFormat.PYTORCH]: 'PyTorch',
};

export const formatProblem = (model: Model, backend: BackendId): string | null => {
  const definition = definitionFor(backend);

  if (!modelRefusals(definition, model).includes(ModelRefusal.FORMAT_NOT_SERVED)) {
    return null;
  }

  const served = definition.declaration.formats.map(format => FORMAT_LABELS[format]).join(' or ');

  return `${model.label} is a ${FORMAT_LABELS[model.format]} model, and ${backend} loads ${served} alone`;
};

export const stagesProblem = (model: Model, backend: BackendId): string | null => {
  if (!modelRefusals(definitionFor(backend), model).includes(ModelRefusal.STAGES_UNLISTED)) {
    return null;
  }

  return `${model.label} ${unlistedStagesMessage(backend, model.architecture)}`;
};
