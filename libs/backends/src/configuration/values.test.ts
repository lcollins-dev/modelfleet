import { describe, expect, it } from 'vitest';

import { buildDeclaration } from '../test/declaration.factory';
import { backendField } from './declaration';
import {
  configuredBoolean,
  configuredNumber,
  configuredNumberList,
  configuredText,
  configuredValue,
  configuredValues,
} from './values';

const declaration = buildDeclaration();
const contextSize = backendField(declaration, 'contextSize')!;

describe('configuredValue', () => {
  it('takes the document value over the declared default', () => {
    expect(configuredValue(contextSize, { contextSize: 8192 })).toBe(8192);
  });

  it('inherits the declared default where the key is absent', () => {
    expect(configuredValue(contextSize, {})).toBe(4096);
  });

  it('applies nothing where the document sets the key to null', () => {
    expect(configuredValue(contextSize, { contextSize: null })).toBeUndefined();
  });

  it('applies nothing where neither the document nor the declaration gives a value', () => {
    expect(configuredValue(backendField(declaration, 'ropeScale')!, {})).toBeUndefined();
  });
});

describe('the typed readers', () => {
  it('read a value of the type they name', () => {
    expect(configuredNumber(declaration, { contextSize: 8192 }, 'contextSize')).toBe(8192);
    expect(configuredBoolean(declaration, { mlock: true }, 'mlock')).toBe(true);
    expect(configuredText(declaration, { chatTemplate: 'chatml' }, 'chatTemplate')).toBe('chatml');
  });

  it('read nothing from a value of another type, which validation reports separately', () => {
    expect(configuredNumber(declaration, { contextSize: 'wide' }, 'contextSize')).toBeUndefined();
  });

  it('read nothing for a key the declaration does not model', () => {
    expect(configuredNumber(declaration, { unknownKey: 1 }, 'unknownKey')).toBeUndefined();
  });

  it('read a number list whole, or nothing where an entry is not a number', () => {
    expect(configuredNumberList(declaration, { tensorSplit: [3, 1] }, 'tensorSplit')).toEqual([3, 1]);
    expect(configuredNumberList(declaration, { tensorSplit: [3, 'x'] }, 'tensorSplit')).toBeUndefined();
  });
});

describe('configuredValues', () => {
  it('reads each field of one document through one declaration, defaults resolved', () => {
    const values = configuredValues(declaration, { contextSize: 8192 });

    expect(values.number('contextSize')).toBe(8192);
    expect(values.text('contextSize')).toBeUndefined();
    expect(values.number('draftModel')).toBeUndefined();
  });
});
