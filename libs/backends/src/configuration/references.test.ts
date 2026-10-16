import { describe, expect, it } from 'vitest';

import { ModelType } from '../model';
import { buildDeclaration } from '../test/declaration.factory';
import { modelReferenceFields, referencedModels, referencesModel } from './references';

const declaration = buildDeclaration();
const FINGERPRINT = 'a'.repeat(64);

describe('modelReferenceFields', () => {
  it('finds every field that points at the catalogue and nothing else', () => {
    expect(modelReferenceFields(declaration).map(field => field.name)).toEqual(['mmproj']);
  });
});

describe('referencedModels', () => {
  it('reads the fingerprint the document applies, carrying the field that accepts it', () => {
    const [reference, ...rest] = referencedModels(declaration, { mmproj: FINGERPRINT });

    expect(rest).toEqual([]);
    expect(reference.fingerprint).toBe(FINGERPRINT);
    expect(reference.field).toMatchObject({ name: 'mmproj', flag: '--mmproj', modelType: ModelType.PROJECTOR });
  });

  it('reads nothing where the document names no companion', () => {
    expect(referencedModels(declaration, {})).toEqual([]);
  });

  it('reads nothing for a field set to null, which is how a document turns the flag off', () => {
    expect(referencedModels(declaration, { mmproj: null })).toEqual([]);
  });

  it('reads nothing where the key holds something that is not text', () => {
    expect(referencedModels(declaration, { mmproj: 42 })).toEqual([]);
  });
});

describe('referencesModel', () => {
  it('finds a fingerprint a reference field names', () => {
    expect(referencesModel(declaration, { mmproj: FINGERPRINT }, FINGERPRINT)).toBe(true);
  });

  it('finds nothing for a fingerprint no field names', () => {
    expect(referencesModel(declaration, { mmproj: FINGERPRINT }, 'b'.repeat(64))).toBe(false);
    expect(referencesModel(declaration, {}, FINGERPRINT)).toBe(false);
  });
});
