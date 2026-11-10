import { ModelType } from '@libs/agent-protocol';

import { Model } from './entities/model.entity';

const TYPE_LABELS: Record<ModelType, string> = {
  [ModelType.MODEL]: 'model',
  [ModelType.PROJECTOR]: 'multimodal projector',
  [ModelType.LORA]: 'LoRA adapter',
  [ModelType.CONTROL_VECTOR]: 'control vector',
  [ModelType.DRAFT]: 'draft model',
};

export interface IResolvedModelReference {
  field: string;

  fingerprint: string;

  /** Names the control on the form, so a refusal reads as the user's own field. */
  label: string;

  modelType: ModelType;

  /** Undefined where the catalogue holds no row for the fingerprint. */
  model: Model | undefined;
}

export const modelTypeLabel = (type: ModelType): string => TYPE_LABELS[type];

/** Null where the catalogue holds the file the field asks for. Otherwise the reason, phrased for a form or a node. */
export const modelReferenceProblem = (reference: IResolvedModelReference): string | null => {
  const wanted = modelTypeLabel(reference.modelType);
  const model = reference.model;

  if (model === undefined) {
    return `The ${wanted} chosen for ${reference.label} is not in the catalogue`;
  }

  if (model.type !== reference.modelType) {
    return `${reference.label} requires a ${wanted}. ${model.label} is a ${modelTypeLabel(model.type)}`;
  }

  return null;
};
