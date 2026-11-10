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

describe('llamaCppSizeVram with weights mirrored in tensor mode', () => {
  it("gives each card a whole copy of HRM's weights, even with the cache in RAM", () => {
    const model = buildEstimatedModel({ architecture: 'hrm_text' });
    const input = { ...placementInput({ splitMode: 'tensor', tensorSplit: [3, 1], noKvOffload: true }), model };
    const shares = llamaCppSizeVram(input, llamaCppDeclaration).cardShares;

    expect(shares?.[0]).toBe(shares?.[1]);
  });
});

describe('llamaCppSizeVram with a fit target', () => {
  const MIB = 1024 * 1024;
  const FIT_TARGET = { fitTarget: 512 };

  const headroomOf = (configuration: BackendConfiguration, cardCount = 2): number | undefined =>
    llamaCppSizeVram(placementInput(configuration, cardCount), llamaCppDeclaration).headroomBytes;

  it("replaces the node's headroom with the target, in bytes", () => {
    expect(headroomOf(FIT_TARGET)).toBe(512 * MIB);
  });

  it('honours a target of zero', () => {
    expect(headroomOf({ fitTarget: 0 })).toBe(0);
  });

  it("leaves the node's headroom alone where no target is set", () => {
    expect(headroomOf({})).toBeUndefined();
  });

  it.each([
    ['tensor mode', { splitMode: 'tensor' }],
    ['a tensor split', { tensorSplit: [3, 1] }],
    ['a tensor override', { tensorOverrides: ['token_embd.weight=CUDA0'] }],
    ['all experts on the CPU', { cpuMoe: true }],
    ['expert layers on the CPU', { cpuMoeLayers: 4 }],
  ])("keeps the node's headroom under %s, where fit does not run", (_name, configuration) => {
    expect(headroomOf({ ...FIT_TARGET, ...configuration })).toBeUndefined();
  });

  it('applies where llama.cpp ignores the split, on a single card or with nothing in it', () => {
    expect(headroomOf({ ...FIT_TARGET, tensorSplit: [3, 1] }, 1)).toBe(512 * MIB);
    expect(headroomOf({ ...FIT_TARGET, tensorSplit: [0, 0] })).toBe(512 * MIB);
  });

  it('applies when the model is not split, since fit still runs', () => {
    expect(headroomOf({ ...FIT_TARGET, splitMode: 'none' })).toBe(512 * MIB);
  });

  it('applies under no split mode with a split set, since llama.cpp then holds one device and ignores it', () => {
    expect(headroomOf({ ...FIT_TARGET, splitMode: 'none', tensorSplit: [3, 1] })).toBe(512 * MIB);
  });
});

describe('llamaCppSizeVram with automatic fitting disabled', () => {
  const OVERRIDE = { tensorOverrides: ['token_embd.weight=CUDA0'] };

  const sizingOf = (values: BackendConfiguration, deviceCount = 2) =>
    llamaCppSizeVram(
      {
        model: buildEstimatedModel(),
        companions: [],
        configuration: { ...BASE, ...values },
        deviceCount,
        cpuPinned: true,
        devices: Array.from({ length: deviceCount }, (_, card) => ({ deviceKey: `GPU-${card}`, totalBytes: null })),
      },
      llamaCppDeclaration
    );

  it('keeps RAM offload under no split mode with a split set, since llama.cpp then holds one device', () => {
    expect(sizingOf({ splitMode: 'none', tensorSplit: [3, 1] }).cardsOnlyReason).toBeUndefined();
  });

  it('disables RAM offload with a tensor split', () => {
    expect(sizingOf({ tensorSplit: [1, 1] }).cardsOnlyReason).toMatch(/automatic fitting/);
  });

  it('disables RAM offload with a tensor override', () => {
    expect(sizingOf(OVERRIDE).cardsOnlyReason).toMatch(/automatic fitting/);
  });

  it('disables automatic RAM offload with CPU-pinned experts', () => {
    expect(sizingOf({ cpuMoe: true }).cardsOnlyReason).toMatch(/automatic fitting/);
  });

  it('keeps fit enabled for an explicit split on a single GPU', () => {
    expect(sizingOf({ tensorSplit: [1] }, 1).cardsOnlyReason).toBeUndefined();
  });

  it('states no RAM restriction on a launch with no CPU pin, which could not spill anyway', () => {
    const sizing = llamaCppSizeVram(
      {
        model: buildEstimatedModel(),
        companions: [],
        configuration: { ...BASE, tensorSplit: [1, 1] },
        deviceCount: 2,
        devices: [
          { deviceKey: 'GPU-0', totalBytes: null },
          { deviceKey: 'GPU-1', totalBytes: null },
        ],
      },
      llamaCppDeclaration
    );

    expect(sizing.cardsOnlyReason).toBeUndefined();
  });

  it('allows RAM offload when no split or override is set', () => {
    expect(sizingOf({}).cardsOnlyReason).toBeUndefined();
  });

  it('marks a launch without a split as using live free memory', () => {
    expect(sizingOf({}).balancedOnFreeMemory).toBe(true);
  });

  it('disables RAM offload with a CPU pin, splitMode none and a tensor override', () => {
    expect(sizingOf({ splitMode: 'none', ...OVERRIDE }).cardsOnlyReason).toMatch(/automatic fitting/);
  });

  it('disables automatic RAM offload with --n-cpu-moe', () => {
    expect(sizingOf({ cpuMoeLayers: 2 }).cardsOnlyReason).toMatch(/automatic fitting/);
  });

  it('disables RAM offload for an override even when estimation is unavailable', () => {
    expect(sizingOf({ ...OVERRIDE, tensorSplit: [1, 1], contextSize: undefined }).cardsOnlyReason).toMatch(
      /automatic fitting/
    );
  });

  it('marks CPU-pinned splitMode none as using live free memory for offload', () => {
    expect(sizingOf({ splitMode: 'none' }).balancedOnFreeMemory).toBe(true);
  });

  it('marks a CPU-pinned split on one card, which leaves fit running', () => {
    expect(sizingOf({ tensorSplit: [1] }, 1).balancedOnFreeMemory).toBe(true);
  });

  it('leaves a placed split unmarked, since it does not read free memory', () => {
    expect(sizingOf({ tensorSplit: [1, 1] }).balancedOnFreeMemory).toBeUndefined();
  });
});
