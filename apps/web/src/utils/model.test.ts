import { describe, expect, it } from 'vitest';

import { ModelFormat, ModelState, ModelType } from '@libs/dto';

import {
  companionLabel,
  formatModelKind,
  formatModelState,
  formatModelType,
  modelFileName,
  modelLabel,
  modelStateTone,
} from './model';

describe('modelStatePresentation', () => {
  it('marks a model an online node holds as the one healthy state', () => {
    expect(modelStateTone(ModelState.AVAILABLE)).toBe('success');
  });

  it('marks a model no online node holds as broken, since it cannot be deployed', () => {
    expect(modelStateTone(ModelState.UNAVAILABLE)).toBe('error');
  });

  it('gives every state a label and a tone', () => {
    for (const state of Object.values(ModelState)) {
      expect(formatModelState(state)).toBeTruthy();
      expect(modelStateTone(state)).toBeTruthy();
    }
  });
});

describe('formatModelKind', () => {
  it('reads the format alongside its quantisation', () => {
    expect(formatModelKind({ format: ModelFormat.GGUF, quantisation: 'Q8_0', quantisationMixed: false })).toBe(
      'GGUF Q8_0'
    );
  });

  it('says a mixed file only mostly holds the quantisation it is named by', () => {
    expect(formatModelKind({ format: ModelFormat.GGUF, quantisation: 'Q8_0', quantisationMixed: true })).toBe(
      'GGUF mostly Q8_0'
    );
  });

  it('falls back to the format alone where the file named no quantisation', () => {
    expect(formatModelKind({ format: ModelFormat.SAFETENSORS, quantisation: null, quantisationMixed: false })).toBe(
      'safetensors'
    );
  });

  it('gives every format a label', () => {
    for (const format of Object.values(ModelFormat)) {
      expect(formatModelKind({ format, quantisation: null, quantisationMixed: false })).toBeTruthy();
    }
  });
});

describe('modelTypePresentation', () => {
  it('leaves a model unlabelled, so a fleet holding models alone reads as it did', () => {
    expect(companionLabel(ModelType.MODEL)).toBeNull();
  });

  it('names a companion, so an operator reads what the file is rather than another model', () => {
    expect(companionLabel(ModelType.PROJECTOR)).toBe('Projector');
    expect(companionLabel(ModelType.LORA)).toBe('LoRA adapter');
    expect(companionLabel(ModelType.CONTROL_VECTOR)).toBe('Control vector');
  });

  it('gives every type a label', () => {
    for (const type of Object.values(ModelType)) {
      expect(formatModelType(type)).toBeTruthy();
    }
  });
});

describe('modelFileName', () => {
  it("reads the file's own name from a node that holds it, since two projectors share a catalogue name", () => {
    expect(modelFileName({ availability: [{ path: '/srv/models/gemma-3-4b/mmproj-F16.gguf' }] })).toBe(
      'mmproj-F16.gguf'
    );
  });

  it('reads nothing where no node holds the file any more', () => {
    expect(modelFileName({ availability: [] })).toBeNull();
  });
});

describe('modelLabel', () => {
  it('labels a model by its display name where it has one', () => {
    expect(modelLabel({ name: 'Llama 3 8B', displayName: 'Llama chat' })).toBe('Llama chat');
  });

  it('falls back to the scanned name where it has none', () => {
    expect(modelLabel({ name: 'Llama 3 8B', displayName: null })).toBe('Llama 3 8B');
  });
});
