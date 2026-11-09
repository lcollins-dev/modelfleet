import { describe, expect, it } from 'vitest';

import { ModelType } from '@libs/backends';

import { servableProblem } from './servable';
import { buildModel } from '@/test/model.factory';

describe('servableProblem', () => {
  it('serves a model', () => {
    expect(servableProblem(buildModel({ type: ModelType.MODEL }))).toBeNull();
  });

  it('refuses a draft model, which only drafts for another', () => {
    expect(servableProblem(buildModel({ type: ModelType.DRAFT }))).toBe(
      'A draft model drafts tokens for another model. It cannot be deployed on its own'
    );
  });
});
