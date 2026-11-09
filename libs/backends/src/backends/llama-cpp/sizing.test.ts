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

describe('llamaCppSizeVram in tensor mode', () => {
  const TENSOR = { splitMode: 'tensor' };
  const deepseek = buildEstimatedModel({ architecture: 'deepseek41' });

  it('divides memory equally across GPUs by default', () => {
    const shares = sharesOf(placementInput(TENSOR));

    expect(shares?.[0]).toBe(shares?.[1]);
    expect(shares?.[0]).toBeGreaterThan(0);
  });

  it('uses configured GPU proportions and adds runtime and compute buffers to each GPU', () => {
    const input = placementInput({ ...TENSOR, tensorSplit: [3, 1] });
    const estimate = estimateOf(input);
    const perCard = estimate.overheadBytes / 2;
    const shared = estimate.totalBytes - estimate.overheadBytes;

    expect(sharesOf(input)).toEqual([Math.round(perCard + shared * 0.75), Math.round(perCard + shared * 0.25)]);
  });

  it('uses equal shares when all configured proportions are zero', () => {
    const shares = sharesOf(placementInput({ ...TENSOR, tensorSplit: [0, 0] }));

    expect(shares?.[0]).toBe(shares?.[1]);
  });

  it('returns proportions for declared VRAM usage when estimation is unavailable', () => {
    const input = placementInput({ ...TENSOR, contextSize: undefined });

    expect(sharesOf(input)).toEqual([1, 1]);
    expect(sharesOf({ ...input, configuration: { ...input.configuration, tensorSplit: [2, 1] } })).toEqual([2, 1]);
  });

  it('disables RAM offloading only in tensor mode', () => {
    expect(llamaCppSizeVram(placementInput(TENSOR), llamaCppDeclaration).cardsOnlyReason).toBe(
      'Tensor mode requires the whole model in VRAM'
    );
    expect(
      llamaCppSizeVram(placementInput({ splitMode: 'layer' }), llamaCppDeclaration).cardsOnlyReason
    ).toBeUndefined();
    expect(
      llamaCppSizeVram(placementInput({ splitMode: 'none' }), llamaCppDeclaration).cardsOnlyReason
    ).toBeUndefined();
    expect(llamaCppSizeVram(placementInput(), llamaCppDeclaration).cardsOnlyReason).toBeUndefined();
  });

  it.each(['deepseek4', 'deepseek41', 'hrm_text'])('counts a full KV cache per GPU for %s', architecture => {
    const model = buildEstimatedModel({ architecture });
    const layer = estimateOf({ ...placementInput({ splitMode: 'layer' }), model });
    const tensor = estimateOf({ ...placementInput(TENSOR), model });

    expect(tensor.kvCacheBytes).toBe(layer.kvCacheBytes * 2);
  });

  it('counts the KV cache once when llama.cpp splits it across GPUs', () => {
    const layer = estimateOf(placementInput({ splitMode: 'layer' }));
    const tensor = estimateOf(placementInput(TENSOR));

    expect(tensor.kvCacheBytes).toBe(layer.kvCacheBytes);
  });

  it('counts one KV cache for a single GPU and zero when KV offloading is disabled', () => {
    const oneCard = { ...placementInput(TENSOR, 1), model: deepseek };
    const offCards = { ...placementInput({ ...TENSOR, noKvOffload: true }), model: deepseek };

    expect(estimateOf(oneCard).kvCacheBytes).toBe(estimateOf({ ...oneCard, configuration: BASE }).kvCacheBytes);
    expect(estimateOf(offCards).kvCacheBytes).toBe(0);
  });

  it('adds a full mirrored KV cache to each GPU regardless of split proportions', () => {
    const input = { ...placementInput({ ...TENSOR, tensorSplit: [3, 1] }), model: deepseek };
    const estimate = estimateOf(input);
    const perCard = (estimate.overheadBytes + estimate.kvCacheBytes) / 2;
    const weights = estimate.weightsBytes;

    expect(sharesOf(input)).toEqual([Math.round(perCard + weights * 0.75), Math.round(perCard + weights * 0.25)]);
  });

  it('counts the KV cache once for mirrored architectures in layer mode', () => {
    const shared = { ...placementInput({ splitMode: 'layer' }), model: deepseek };

    expect(estimateOf(shared).kvCacheBytes).toBe(estimateOf({ ...shared, configuration: BASE }).kvCacheBytes);
  });
});

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
