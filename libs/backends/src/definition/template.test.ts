import { describe, expect, it } from 'vitest';

import { llamaCppDeclaration } from '../backends/llama-cpp/declaration';
import { BackendFieldType, BackendDeclaration } from '../configuration';
import { ModelType } from '../model';
import { elementProblems, fillPlaceholders } from './template';

const withTokenizer: BackendDeclaration = {
  ...llamaCppDeclaration,
  fields: [
    ...llamaCppDeclaration.fields,
    {
      name: 'tokenizer',
      label: 'Tokenizer',
      description: 'The tokenizer the model reads.',
      group: 'multimodal',
      type: BackendFieldType.MODEL_REFERENCE,
      modelType: ModelType.MODEL,
    },
  ],
};

const values = new Map([
  ['served_model', 'a b {{port}}'],
  ['port', '8080'],
]);

const valueOf = (name: string): string | undefined => values.get(name);

describe('fillPlaceholders', () => {
  it('fills every placeholder in an element', () => {
    expect(fillPlaceholders('{{served_model}}:{{port}}', valueOf)).toBe('a b {{port}}:8080');
  });

  it('inserts a value holding a replacement pattern as written', () => {
    expect(fillPlaceholders('{{served_model}}', name => (name === 'served_model' ? "$& $1 $' end" : undefined))).toBe(
      "$& $1 $' end"
    );
  });

  it('never scans a filled value again', () => {
    expect(fillPlaceholders('{{served_model}}', valueOf)).toBe('a b {{port}}');
  });

  it('answers nothing where any placeholder has no value', () => {
    expect(fillPlaceholders('{{port}}-{{gpu_ids}}', valueOf)).toBeUndefined();
  });

  it('passes an element with no placeholder as written', () => {
    expect(fillPlaceholders('--host', valueOf)).toBe('--host');
  });
});

describe('elementProblems', () => {
  it('accepts every listed placeholder, a declared param and a model reference companion', () => {
    const element =
      '{{model_path}}{{served_model}}{{port}}{{gpu_count}}{{gpu_ids}}{{param.image}}{{companion.tokenizer}}';

    expect(elementProblems(element, withTokenizer)).toEqual([]);
  });

  it('refuses a name the placeholders do not list', () => {
    expect(elementProblems('{{model}}', llamaCppDeclaration)).toEqual(['{{model}} is not a placeholder']);
  });

  it('refuses a param naming no declared field', () => {
    expect(elementProblems('{{param.ctx}}', llamaCppDeclaration)).toEqual(['{{param.ctx}} names no declared field']);
  });

  it('refuses a param naming a field that already passes its own flag, which would pass the value twice', () => {
    expect(elementProblems('{{param.contextSize}}', llamaCppDeclaration)).toEqual([
      '{{param.contextSize}} names a field that already passes its own flag',
    ]);
  });

  it('refuses a companion whose field already passes its own flag', () => {
    expect(elementProblems('{{companion.mmproj}}', llamaCppDeclaration)).toEqual([
      '{{companion.mmproj}} names a field that already passes its own flag',
    ]);
  });

  it('refuses a companion naming a field that is not a model reference', () => {
    expect(elementProblems('{{companion.contextSize}}', llamaCppDeclaration)).toEqual([
      '{{companion.contextSize}} names no model reference field',
    ]);
  });

  it('refuses a `{{` that opens no placeholder, so a literal one is not expressible', () => {
    expect(elementProblems('{{port', llamaCppDeclaration)).toEqual(['{{ opens no placeholder']);
  });
});
