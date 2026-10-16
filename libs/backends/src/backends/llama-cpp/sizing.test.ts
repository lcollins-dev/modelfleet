import { describe, expect, it } from 'vitest';

import { BackendConfiguration, BackendFieldType } from '../../configuration';
import { GIB } from '../../definition';
import { IComputedVramEstimate, IVramEstimateInput } from '../../runtime';
import { buildEstimatedModel } from '../../test/container.factory';
import { LlamaCppField, llamaCppDeclaration } from './declaration';
import { llamaCppSizeVram } from './sizing';

const BASE = { contextSize: 8192, ubatchSize: 512, cacheTypeK: 'f16', cacheTypeV: 'f16' };

const placementInput = (configuration: BackendConfiguration = {}, cardCount = 2): IVramEstimateInput => ({
  model: buildEstimatedModel(),
  companions: [],
  configuration: { ...BASE, ...configuration },
  deviceCount: cardCount,
  devices: Array.from({ length: cardCount }, (_, card) => ({ deviceKey: `GPU-${card}`, totalBytes: 24 * GIB })),
});

const sharesOf = (input: IVramEstimateInput): number[] | null =>
  llamaCppSizeVram(input, llamaCppDeclaration).cardShares;

const estimateOf = (input: IVramEstimateInput, declaration = llamaCppDeclaration): IComputedVramEstimate => {
  const estimate = llamaCppSizeVram(input, declaration).estimate;

  if (!estimate.computed) {
    throw new Error('Expected an estimate');
  }

  return estimate;
};

describe('llamaCppSizeVram card shares', () => {
  it("shares the weights and cache by the operator's split, and gives every card its own runtime and compute buffer", () => {
    const input = placementInput({ tensorSplit: [9, 1] });
    const estimate = estimateOf(input);
    const perCard = estimate.overheadBytes / 2;
    const shared = estimate.totalBytes - estimate.overheadBytes;

    expect(sharesOf(input)).toEqual([Math.round(perCard + shared * 0.9), Math.round(perCard + shared * 0.1)]);
  });

  it('accounts for the whole estimate across the split', () => {
    const input = placementInput({ tensorSplit: [3, 1] });
    const shares = sharesOf(input) ?? [];

    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(estimateOf(input).totalBytes, -1);
  });

  it('gives a card the split leaves out its runtime and compute buffer alone', () => {
    const input = placementInput({ tensorSplit: [3] });

    expect(sharesOf(input)?.[1]).toBe(Math.round(estimateOf(input).overheadBytes / 2));
  });

  it("follows the operator's split by its proportions where the deployment cannot be estimated", () => {
    const input = { ...placementInput({ tensorSplit: [3, 1] }), model: buildEstimatedModel({ layerCount: null }) };

    expect(sharesOf(input)).toEqual([3, 1]);
  });

  it('places nothing where llama.cpp balances the cards itself, with fit or without', () => {
    for (const configuration of [{}, { tensorSplit: [0, 0] }, { cpuMoeLayers: 4 }, { tensorOverrides: ['x=CPU'] }]) {
      expect(sharesOf(placementInput(configuration))).toBeNull();
    }
  });

  it('places everything on the first card where the model is not split', () => {
    expect(sharesOf(placementInput({ splitMode: 'none' }))).toEqual([1, 0]);
  });

  it('leaves a row or tensor split to llama.cpp', () => {
    for (const splitMode of ['row', 'tensor']) {
      expect(sharesOf(placementInput({ splitMode, tensorSplit: [1, 1] }))).toBeNull();
    }
  });
});

describe('llamaCppSizeVram', () => {
  it('reads its fields through the declaration it is handed', () => {
    const input = { ...placementInput(), configuration: { contextSize: 8192, ubatchSize: 512, cacheTypeV: 'f16' } };
    const fields = llamaCppDeclaration.fields.map(field =>
      field.name === LlamaCppField.CACHE_TYPE_K && field.type === BackendFieldType.CHOICE
        ? { ...field, default: 'q8_0' }
        : field
    );
    const handed = estimateOf(input, { ...llamaCppDeclaration, fields });
    const own = estimateOf(input);

    expect(handed.kvCacheBytes).toBeLessThan(own.kvCacheBytes);
  });
});
