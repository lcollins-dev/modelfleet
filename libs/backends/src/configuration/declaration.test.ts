import { describe, expect, it } from 'vitest';

import { buildDeclaration } from '../test/declaration.factory';
import { backendField } from './declaration';

describe('backendField', () => {
  it('finds a field by its document key', () => {
    expect(backendField(buildDeclaration(), 'contextSize')?.label).toBe('Context size');
  });

  it('finds nothing for a key the declaration does not model', () => {
    expect(backendField(buildDeclaration(), 'draftModel')).toBeUndefined();
  });
});
