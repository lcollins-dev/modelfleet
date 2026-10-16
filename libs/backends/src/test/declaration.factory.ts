import { BackendFieldType, CONFIGURATION_SCHEMA_VERSION, BackendDeclaration, extraFlagsField } from '../configuration';
import { ModelFormat, ModelType } from '../model';

/** Builds a declaration covering every field type, for exercising the schema and the validator. */
export const buildDeclaration = (overrides: Partial<BackendDeclaration> = {}): BackendDeclaration => ({
  schemaVersion: CONFIGURATION_SCHEMA_VERSION,
  formats: [ModelFormat.GGUF],
  groups: [
    { group: 'context', label: 'Context' },
    { group: 'advanced', label: 'Advanced' },
  ],
  fields: [
    {
      name: 'contextSize',
      flag: '--ctx-size',
      label: 'Context size',
      description: 'Tokens of context.',
      group: 'context',
      type: BackendFieldType.INTEGER,
      default: 4096,
      min: 1,
      max: 131072,
    },
    {
      name: 'ropeScale',
      flag: '--rope-scale',
      label: 'RoPE scale',
      description: 'Context stretch factor.',
      group: 'context',
      type: BackendFieldType.NUMBER,
      min: 0,
    },
    {
      name: 'mlock',
      flag: '--mlock',
      label: 'Lock weights',
      description: 'Keeps the weights resident.',
      group: 'context',
      type: BackendFieldType.BOOLEAN,
      default: false,
    },
    {
      name: 'chatTemplate',
      flag: '--chat-template',
      label: 'Chat template',
      description: 'Named template.',
      group: 'context',
      type: BackendFieldType.TEXT,
    },
    {
      name: 'splitMode',
      flag: '--split-mode',
      label: 'Split mode',
      description: 'How the model is divided.',
      group: 'context',
      type: BackendFieldType.CHOICE,
      choices: ['none', 'layer', 'row'],
      default: 'layer',
    },
    {
      name: 'tensorSplit',
      flag: '--tensor-split',
      label: 'Tensor split',
      description: 'Proportion per GPU.',
      group: 'context',
      type: BackendFieldType.NUMBER_LIST,
      min: 0,
    },
    {
      name: 'mmproj',
      flag: '--mmproj',
      label: 'Projector',
      description: 'Companion the model reads images with.',
      group: 'context',
      type: BackendFieldType.MODEL_REFERENCE,
      modelType: ModelType.PROJECTOR,
    },
    extraFlagsField('advanced'),
  ],

  ...overrides,
});
