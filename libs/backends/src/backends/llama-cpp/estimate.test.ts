import { describe, expect, it } from 'vitest';

import { BackendConfiguration } from '../../configuration';
import { EstimateBasis, EstimateInputSource, IVramEstimate, IVramEstimateInput } from '../../runtime';
import { buildEstimatedModel } from '../../test/container.factory';
import { llamaCppDeclaration } from './declaration';
import { llamaCppSizeVram } from './sizing';

const configuration: BackendConfiguration = {
  contextSize: 8192,
  parallel: 4,
  ubatchSize: 512,
  cacheTypeK: 'f16',
  cacheTypeV: 'f16',
};

const estimate = (overrides: Partial<IVramEstimateInput> = {}): IVramEstimate =>
  llamaCppSizeVram(
    {
      model: buildEstimatedModel(),
      companions: [],
      configuration,
      deviceCount: 1,
      devices: [{ deviceKey: 'GPU-0', totalBytes: null }],
      ...overrides,
    },
    llamaCppDeclaration
  ).estimate;

const computed = (overrides: Partial<IVramEstimateInput> = {}) => {
  const result = estimate(overrides);

  if (!result.computed) {
    throw new Error(`Expected an estimate, got missing ${result.missing.map(entry => entry.field).join(', ')}`);
  }

  return result;
};

const missingFields = (overrides: Partial<IVramEstimateInput>): string[] => {
  const result = estimate(overrides);

  return result.computed ? [] : result.missing.map(entry => entry.field);
};

describe('llamaCppSizeVram estimate', () => {
  it('sums the weights, the KV cache and the overhead into the total', () => {
    const result = computed();

    expect(result.totalBytes).toBe(result.weightsBytes + result.kvCacheBytes + result.overheadBytes);
    expect(result.weightsBytes).toBeGreaterThan(0);
    expect(result.kvCacheBytes).toBeGreaterThan(0);
    expect(result.overheadBytes).toBeGreaterThan(0);
  });

  it('takes the whole model, since every layer is offloaded', () => {
    expect(computed().weightsBytes).toBe(buildEstimatedModel().sizeBytes);
  });

  describe('the prompt cache', () => {
    const MIB = 1024 * 1024;
    const withCache = (promptCache: number) => ({ configuration: { ...configuration, promptCache } });

    it("counts llama.cpp's default where the field is unset", () => {
      expect(computed().hostCacheBytes).toBe(8192 * MIB);
    });

    it('counts the configured value in bytes', () => {
      expect(computed(withCache(2048)).hostCacheBytes).toBe(2048 * MIB);
    });

    it('counts nothing where the cache is disabled', () => {
      expect(computed(withCache(0)).hostCacheBytes).toBe(0);
    });

    it('changes neither the host weights, the resident figure nor the total', () => {
      const unset = computed();
      const set = computed(withCache(2048));

      expect(set.hostWeightsBytes).toBe(unset.hostWeightsBytes);
      expect(set.hostResidentBytes).toBe(unset.hostResidentBytes);
      expect(set.totalBytes).toBe(unset.totalBytes);
    });

    it('reads the cache even where the estimate cannot be made', () => {
      const result = estimate({ configuration: { ...configuration, contextSize: undefined, promptCache: 2048 } });

      expect(result).toMatchObject({ computed: false, hostCacheBytes: 2048 * MIB });
    });
  });

  it('reads the model header, whatever the cards hold', () => {
    expect(computed().basis).toBe(EstimateBasis.METADATA);
  });

  it("counts a projector's bytes whole beside the model's", () => {
    const projected = computed({ companions: [{ field: 'mmproj', sizeBytes: 812_000_000, metadata: null }] });

    expect(projected.weightsBytes).toBe(buildEstimatedModel().sizeBytes + 812_000_000);
    expect(projected.totalBytes).toBe(computed().totalBytes + 812_000_000);
  });

  it('caches every layer, so the figure scales with the block count alone', () => {
    const shallow = computed({ model: buildEstimatedModel({ layerCount: 16 }) });

    expect(shallow.kvCacheBytes).toBe(computed().kvCacheBytes / 2);
  });

  it('scales the KV cache with the configured context', () => {
    const wide = computed({ configuration: { ...configuration, contextSize: 16384 } });

    expect(wide.kvCacheBytes).toBe(computed().kvCacheBytes * 2);
  });

  it('takes the model trained length for each slot where the context is left to the backend', () => {
    const auto = computed({ configuration: { ...configuration, contextSize: 0 } });

    expect(auto.kvCacheBytes).toBe(computed({ configuration: { ...configuration, contextSize: 32768 } }).kvCacheBytes);
  });

  it('shrinks the KV cache where the cache is quantised', () => {
    const quantised = computed({ configuration: { ...configuration, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0' } });

    expect(quantised.kvCacheBytes).toBeLessThan(computed().kvCacheBytes);
  });

  it('sizes every cache type the declaration offers', () => {
    const iq4 = computed({ configuration: { ...configuration, cacheTypeK: 'iq4_nl', cacheTypeV: 'iq4_nl' } });

    expect(iq4.kvCacheBytes).toBeLessThan(computed().kvCacheBytes);
  });

  it('holds no KV cache on the GPU where it is kept in host memory', () => {
    const offKv = computed({ configuration: { ...configuration, noKvOffload: true } });

    expect(offKv.kvCacheBytes).toBe(0);
    expect(offKv.weightsBytes).toBe(computed().weightsBytes);
  });

  it('leaves out the n-gram table and the token table, which llama.cpp keeps on the CPU', () => {
    const model = buildEstimatedModel({
      sizeBytes: 119_600_000_000,
      tensors: [
        { name: 'per_layer_token_embd.weight', sizeBytes: 35_200_168_960 },
        { name: 'token_embd.weight', sizeBytes: 1_146_880_000 },
        { name: 'output.weight', sizeBytes: 1_146_880_000 },
      ],
    });

    const result = computed({
      model,
      configuration: { ...configuration, tensorOverrides: ['per_layer_token_embd.weight=CPU'] },
    });

    expect(result.weightsBytes).toBe(83_252_951_040);
    expect(result.hostWeightsBytes).toBe(36_347_048_960);
    expect(result.totalBytes).toBe(result.weightsBytes + result.kvCacheBytes + result.overheadBytes);
  });

  it('keeps a copy of the token table on the cards where the model reads it as its output layer', () => {
    const result = computed({
      model: buildEstimatedModel({ tensors: [{ name: 'token_embd.weight', sizeBytes: 1_000_000_000 }] }),
    });

    expect(result.weightsBytes).toBe(buildEstimatedModel().sizeBytes);
    expect(result.hostWeightsBytes).toBe(1_000_000_000);
  });

  it('keeps the whole model where no tensor is kept on the CPU', () => {
    const result = computed({
      model: buildEstimatedModel({ tensors: [{ name: 'blk.0.ffn_up.weight', sizeBytes: 1_000_000_000 }] }),
    });

    expect(result.weightsBytes).toBe(buildEstimatedModel().sizeBytes);
    expect(result.hostWeightsBytes).toBe(0);
  });

  describe('host memory', () => {
    const model = buildEstimatedModel({
      tensors: [
        { name: 'per_layer_token_embd.weight', sizeBytes: 35_000_000_000 },
        { name: 'token_embd.weight', sizeBytes: 1_000_000_000 },
        { name: 'output.weight', sizeBytes: 1_000_000_000 },
        { name: 'blk.0.ffn_up_exps.weight', sizeBytes: 300_000_000 },
        { name: 'blk.1.ffn_up_exps.weight', sizeBytes: 200_000_000 },
      ],
    });

    const resident = (loadMode?: string): number =>
      computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode } }).hostResidentBytes;

    it('holds the experts in full where the file is mapped, since every one is read over a few tokens', () => {
      expect(resident()).toBe(500_000_000);
    });

    it('holds no lookup table where the file is mapped, so the n-gram table is read from disk', () => {
      for (const loadMode of ['auto', 'mmap']) {
        expect(resident(loadMode)).toBe(500_000_000);
      }
    });

    it('holds every host tensor in full where the load mode reads or locks the file and no table is lazy', () => {
      for (const loadMode of ['none', 'dio', 'mlock', 'mmap+mlock']) {
        expect(resident(loadMode)).toBe(36_500_000_000);
      }
    });

    it('holds all but a lazy table where the load mode reads the file, and that too under mmap+mlock', () => {
      const lazy = { ...model, architecture: 'deepseek41' };
      const residentLazy = (loadMode: string): number =>
        computed({ model: lazy, configuration: { ...configuration, cpuMoe: true, loadMode } }).hostResidentBytes;

      for (const loadMode of ['none', 'dio', 'mlock']) {
        expect(residentLazy(loadMode)).toBe(1_500_000_000);
      }

      expect(residentLazy('mmap+mlock')).toBe(36_500_000_000);
    });

    it('holds the token table in full where the model reads it whole as its output layer from host memory', () => {
      const tied = buildEstimatedModel({ tensors: [{ name: 'token_embd.weight', sizeBytes: 1_000_000_000 }] });
      const shared = { ...configuration, tensorOverrides: ['^token_embd=CPU'] };

      expect(computed({ model: tied, configuration: shared }).hostResidentBytes).toBe(1_000_000_000);
      expect(computed({ model: tied }).hostResidentBytes).toBe(0);
    });

    it('holds nothing where nothing is kept in host memory', () => {
      const dense = buildEstimatedModel({ tensors: [{ name: 'output.weight', sizeBytes: 1_000_000_000 }] });

      expect(computed({ model: dense, configuration: { ...configuration, loadMode: 'none' } }).hostResidentBytes).toBe(
        0
      );
    });
  });

  describe('lazy tables', () => {
    const FOUR_GIB = 4 * 1024 ** 3;
    const OVER = FOUR_GIB + 1;
    const UNDER = 1_000_000_000;
    const EXPERTS = 500_000_000;
    const TABLE = 'per_layer_token_embd.weight';

    const READING_LOAD_MODES = ['none', 'mlock', 'dio'];
    const MAPPED_LOAD_MODES = [undefined, 'auto', 'mmap'];
    const ALL_LAZY_MODES = [undefined, 'auto', 'on', 'off'];

    const modelWith = (
      tableBytes: number,
      architecture: string | null = 'deepseek41',
      tableName: string = TABLE
    ): ReturnType<typeof buildEstimatedModel> =>
      buildEstimatedModel({
        architecture,
        sizeBytes: 400_000_000_000,
        tensors: [
          { name: tableName, sizeBytes: tableBytes },
          { name: 'output.weight', sizeBytes: 1_000_000_000 },
          { name: 'blk.0.ffn_up_exps.weight', sizeBytes: EXPERTS },
        ],
      });

    const held = (tableBytes: number, loadMode?: string, lazyMode?: string): number =>
      computed({
        model: modelWith(tableBytes),
        configuration: { ...configuration, cpuMoe: true, loadMode, lazyMode },
      }).hostResidentBytes;

    it('counts no table where the file is mapped, whatever the lazy mode or size', () => {
      for (const loadMode of MAPPED_LOAD_MODES) {
        for (const lazyMode of ALL_LAZY_MODES) {
          expect(held(OVER, loadMode, lazyMode)).toBe(EXPERTS);
          expect(held(UNDER, loadMode, lazyMode)).toBe(EXPERTS);
        }
      }
    });

    it('counts no table over the threshold under a reading load mode with lazy mode auto or unset', () => {
      for (const loadMode of READING_LOAD_MODES) {
        for (const lazyMode of [undefined, 'auto']) {
          expect(held(OVER, loadMode, lazyMode)).toBe(EXPERTS);
        }
      }
    });

    it('counts a table under the threshold in full under a reading load mode with lazy mode auto or unset', () => {
      for (const loadMode of READING_LOAD_MODES) {
        for (const lazyMode of [undefined, 'auto']) {
          expect(held(UNDER, loadMode, lazyMode)).toBe(UNDER + EXPERTS);
        }
      }
    });

    it('counts no table of any size under a reading load mode with lazy mode on', () => {
      for (const loadMode of READING_LOAD_MODES) {
        expect(held(OVER, loadMode, 'on')).toBe(EXPERTS);
        expect(held(UNDER, loadMode, 'on')).toBe(EXPERTS);
      }
    });

    it('counts a table of any size in full under a reading load mode with lazy mode off', () => {
      for (const loadMode of READING_LOAD_MODES) {
        expect(held(OVER, loadMode, 'off')).toBe(OVER + EXPERTS);
        expect(held(UNDER, loadMode, 'off')).toBe(UNDER + EXPERTS);
      }
    });

    it('counts every table in full under mmap+mlock, whatever the lazy mode or size', () => {
      for (const lazyMode of ALL_LAZY_MODES) {
        expect(held(OVER, 'mmap+mlock', lazyMode)).toBe(OVER + EXPERTS);
        expect(held(UNDER, 'mmap+mlock', lazyMode)).toBe(UNDER + EXPERTS);
      }
    });

    it('takes a table of exactly the threshold as not lazy, since llama.cpp wants it strictly larger', () => {
      expect(held(FOUR_GIB, 'none')).toBe(FOUR_GIB + EXPERTS);
      expect(held(FOUR_GIB + 1, 'none')).toBe(EXPERTS);
    });

    it('treats every architecture that marks the table alike', () => {
      for (const architecture of ['deepseek41', 'qwen4exp', 'gemma4']) {
        const model = modelWith(OVER, architecture);

        expect(
          computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none' } }).hostResidentBytes
        ).toBe(EXPERTS);
      }
    });

    it('counts the table in full on an architecture that does not mark it, even with lazy mode on', () => {
      const model = modelWith(OVER, 'gemma3n');

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes
      ).toBe(OVER + EXPERTS);
    });

    it('counts the table in full where the architecture is unknown', () => {
      const model = modelWith(OVER, null);

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes
      ).toBe(OVER + EXPERTS);
    });

    it('counts a token table over the threshold in full, since llama.cpp never reads one lazily', () => {
      const model = modelWith(OVER, 'deepseek41', 'token_embd.weight');

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes
      ).toBe(OVER + EXPERTS);
    });

    it('counts a lazy table toward the host weights and takes it off the cards', () => {
      const result = computed({
        model: modelWith(OVER),
        configuration: { ...configuration, cpuMoe: true, loadMode: 'none' },
      });

      expect(result.hostWeightsBytes).toBe(OVER + EXPERTS);
      expect(result.weightsBytes).toBe(400_000_000_000 - OVER - EXPERTS);
    });

    describe('with an override naming a card', () => {
      const overridden = (tableBytes: number, loadMode: string, lazyMode?: string) =>
        computed({
          model: modelWith(tableBytes),
          configuration: { ...configuration, loadMode, lazyMode, tensorOverrides: ['per_layer_token_embd=CUDA0'] },
        });

      it('keeps a lazy table in host memory, as llama.cpp ignores the override for it', () => {
        const result = overridden(OVER, 'none');

        expect(result.hostWeightsBytes).toBe(OVER);
        expect(result.hostResidentBytes).toBe(0);
        expect(result.weightsBytes).toBe(400_000_000_000 - OVER);
      });

      it('keeps a lazy table in host memory where the file is mapped too', () => {
        expect(overridden(OVER, 'mmap').hostWeightsBytes).toBe(OVER);
        expect(overridden(UNDER, 'auto', 'on').hostWeightsBytes).toBe(UNDER);
      });

      it('holds a lazy table in full under mmap+mlock, and still off the cards', () => {
        const result = overridden(OVER, 'mmap+mlock');

        expect(result.hostWeightsBytes).toBe(OVER);
        expect(result.hostResidentBytes).toBe(OVER);
      });

      it('sends a table llama.cpp would not make lazy to the card', () => {
        for (const result of [
          overridden(OVER, 'none', 'off'),
          overridden(UNDER, 'none'),
          overridden(OVER, 'auto', 'off'),
        ]) {
          expect(result.hostWeightsBytes).toBe(0);
          expect(result.hostResidentBytes).toBe(0);
          expect(result.weightsBytes).toBe(400_000_000_000);
        }
      });
    });
  });

  describe('a draft model', () => {
    const DRAFT_BYTES = 8_000_000_000;

    /** The 8192 context x 8 layers x (2048 / 16 x 1) width x 4 bytes of an f16 key and value. */
    const DRAFT_KV_BYTES = 33_554_432;

    /** The 8 MiB mask for one card and 512 x 2048 x 64 of activations. */
    const DRAFT_COMPUTE_BYTES = 75_497_472;

    const METADATA = { layerCount: 8, embeddingLength: 2048, headCount: 16, headCountKv: 1 };

    const draftOf = (metadata: typeof METADATA | null = METADATA) => [
      { field: 'draftModel', sizeBytes: DRAFT_BYTES, metadata },
    ];

    it('counts its file, its KV cache and its context', () => {
      const without = computed();
      const drafted = computed({ companions: draftOf() });

      expect(drafted.weightsBytes - without.weightsBytes).toBe(DRAFT_BYTES);
      expect(drafted.kvCacheBytes - without.kvCacheBytes).toBe(DRAFT_KV_BYTES);
      expect(drafted.overheadBytes - without.overheadBytes).toBe(DRAFT_COMPUTE_BYTES);
    });

    it('sizes the KV at the main context length', () => {
      const without = computed({ configuration: { ...configuration, contextSize: 16384 } });
      const drafted = computed({ configuration: { ...configuration, contextSize: 16384 }, companions: draftOf() });

      expect(drafted.kvCacheBytes - without.kvCacheBytes).toBe(DRAFT_KV_BYTES * 2);
    });

    it("keeps its own f16 cache whatever the main model's is", () => {
      const quantised = { ...configuration, cacheTypeK: 'q8_0', cacheTypeV: 'q8_0' };
      const without = computed({ configuration: quantised });
      const drafted = computed({ configuration: quantised, companions: draftOf() });

      expect(drafted.kvCacheBytes - without.kvCacheBytes).toBe(DRAFT_KV_BYTES);
    });

    it('takes four copies of its mask on a layer split, even where the main model overrides tensors', () => {
      const overridden = { ...configuration, tensorOverrides: ['x=CPU'] };
      const without = computed({ deviceCount: 2, configuration: overridden });
      const drafted = computed({ deviceCount: 2, configuration: overridden, companions: draftOf() });

      expect(drafted.overheadBytes - without.overheadBytes).toBe(2 * (DRAFT_COMPUTE_BYTES + 3 * 8 * 1024 * 1024));
    });

    it('counts its file alone where its metadata is missing', () => {
      const without = computed();

      for (const drafted of [
        computed({ companions: draftOf(null) }),
        computed({ companions: draftOf({ ...METADATA, headCountKv: null as unknown as number }) }),
      ]) {
        expect(drafted.weightsBytes - without.weightsBytes).toBe(DRAFT_BYTES);
        expect(drafted.kvCacheBytes).toBe(without.kvCacheBytes);
        expect(drafted.overheadBytes).toBe(without.overheadBytes);
      }
    });

    it('holds no host memory for a draft on the cards', () => {
      expect(computed({ companions: draftOf() }).hostResidentBytes).toBe(0);
    });

    it('sizes only the draft field, leaving a projector at its file', () => {
      const without = computed();
      const projected = computed({ companions: [{ field: 'mmproj', sizeBytes: DRAFT_BYTES, metadata: METADATA }] });

      expect(projected.kvCacheBytes).toBe(without.kvCacheBytes);
      expect(projected.overheadBytes).toBe(without.overheadBytes);
    });
  });

  it('grows the overhead with each device the instance holds', () => {
    expect(computed({ deviceCount: 2 }).overheadBytes).toBeGreaterThan(computed().overheadBytes);
  });

  it('takes the overhead on the main GPU alone where the model is not split', () => {
    const unsplit = computed({ deviceCount: 2, configuration: { ...configuration, splitMode: 'none' } });

    expect(unsplit.overheadBytes).toBe(computed().overheadBytes);
  });

  describe('compute buffer', () => {
    const MIB = 1024 * 1024;

    /** One f16 element per cached position per token of the physical batch: 8192 x 512 x 2 bytes. */
    const MASK_BYTES = 8 * MIB;

    it('holds the attention mask on a card, growing with the context', () => {
      const wide = computed({ configuration: { ...configuration, contextSize: 16384 } });

      expect(wide.overheadBytes - computed().overheadBytes).toBe(MASK_BYTES);
    });

    it('holds an f32 mask where flash attention is off', () => {
      const unflashed = computed({ configuration: { ...configuration, flashAttn: 'off' } });

      expect(unflashed.overheadBytes - computed().overheadBytes).toBe(MASK_BYTES);
    });

    it('holds four copies of the mask on each card of a layer split, which llama.cpp pipelines', () => {
      const pipelined = computed({ deviceCount: 2 });
      const overridden = computed({ deviceCount: 2, configuration: { ...configuration, tensorOverrides: ['x=CPU'] } });

      expect(pipelined.overheadBytes - overridden.overheadBytes).toBe(2 * 3 * MASK_BYTES);
    });

    it('holds one copy where expert layers stay on the CPU, which overrides tensors too', () => {
      const moe = computed({ deviceCount: 2, configuration: { ...configuration, cpuMoeLayers: 4 } });
      const overridden = computed({ deviceCount: 2, configuration: { ...configuration, tensorOverrides: ['x=CPU'] } });

      expect(moe.overheadBytes).toBe(overridden.overheadBytes);
    });

    it('holds no mask on the cards where the cache stays in host memory', () => {
      const offKv = computed({ configuration: { ...configuration, noKvOffload: true } });

      expect(computed().overheadBytes - offKv.overheadBytes).toBe(MASK_BYTES);
    });
  });

  it('gives no figure where the metadata the formula needs is missing', () => {
    const model = buildEstimatedModel({ layerCount: null, headCountKv: null });

    expect(missingFields({ model })).toEqual(['layerCount', 'headCountKv']);
  });

  it('names the metadata source, so a caller can say the model row is the gap', () => {
    const result = estimate({ model: buildEstimatedModel({ layerCount: null }) });

    expect(result.computed).toBe(false);
    expect(result.computed ? [] : result.missing).toEqual([
      { source: EstimateInputSource.MODEL_METADATA, field: 'layerCount' },
    ]);
  });

  it('names the configuration source for a field it left unset', () => {
    const result = estimate({ configuration: { ...configuration, ubatchSize: null } });

    expect(result.computed ? [] : result.missing).toEqual([
      { source: EstimateInputSource.CONFIGURATION, field: 'ubatchSize' },
    ]);
  });

  it('wants the trained length only where the context is left to the backend', () => {
    const model = buildEstimatedModel({ contextLength: null });

    expect(estimate({ model }).computed).toBe(true);
    expect(missingFields({ model, configuration: { ...configuration, contextSize: 0 } })).toEqual(['contextLength']);
  });

  it('wants the slot count only where the context is left to the backend', () => {
    const withoutParallel = { ...configuration, parallel: null };

    expect(estimate({ configuration: withoutParallel }).computed).toBe(true);
    expect(missingFields({ configuration: { ...withoutParallel, contextSize: 0 } })).toEqual(['parallel']);
  });

  it('reports every missing input at once rather than the first', () => {
    const model = buildEstimatedModel({ embeddingLength: null, headCount: null });

    expect(missingFields({ model, configuration: { ...configuration, ubatchSize: null } })).toEqual([
      'embeddingLength',
      'headCount',
      'ubatchSize',
    ]);
  });
});
