import { describe, expect, it } from 'vitest';

import { BackendConfiguration } from '../../configuration';
import { EstimateBasis, EstimateInputSource, IEstimatedModel, IVramEstimate, IVramEstimateInput } from '../../runtime';
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

const GIB_BYTES = 1024 ** 3;

/** The activations of one physical batch, which a CPU-held expert computes in system memory. */
const CPU_COMPUTE = 512 * 4096 * 64;

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

  describe('a projector kept off the GPU', () => {
    const PROJECTOR_BYTES = 812_000_000;
    const PROJECTOR = { field: 'mmproj', sizeBytes: PROJECTOR_BYTES, metadata: null };
    const inRam = { ...configuration, noMmprojOffload: true };

    it('counts in RAM rather than VRAM', () => {
      const kept = computed({ configuration: inRam, companions: [PROJECTOR] });

      expect(kept.weightsBytes).toBe(buildEstimatedModel().sizeBytes);
      expect(kept.totalBytes).toBe(computed().totalBytes);
      expect(kept.hostWeightsBytes).toBe(PROJECTOR_BYTES);
      expect(kept.hostResidentBytes).toBe(PROJECTOR_BYTES);
    });

    it('leaves a draft model on the cards', () => {
      const draft = { field: 'draftModel', sizeBytes: GIB_BYTES, metadata: null };
      const kept = computed({ configuration: inRam, companions: [PROJECTOR, draft] });

      expect(kept.weightsBytes).toBe(buildEstimatedModel().sizeBytes + GIB_BYTES);
      expect(kept.hostResidentBytes).toBe(PROJECTOR_BYTES);
    });

    it('counts nothing where the deployment has no projector', () => {
      expect(computed({ configuration: inRam }).hostResidentBytes).toBe(computed().hostResidentBytes);
    });

    it('stays on the cards with the option off', () => {
      const offloaded = computed({
        configuration: { ...configuration, noMmprojOffload: false },
        companions: [PROJECTOR],
      });

      expect(offloaded.hostWeightsBytes).toBe(0);
      expect(offloaded.weightsBytes).toBe(buildEstimatedModel().sizeBytes + PROJECTOR_BYTES);
    });
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
      computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode } }).hostResidentBytes - CPU_COMPUTE;

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
        computed({ model: lazy, configuration: { ...configuration, cpuMoe: true, loadMode } }).hostResidentBytes -
        CPU_COMPUTE;

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
      }).hostResidentBytes - CPU_COMPUTE;

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
          computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none' } }).hostResidentBytes -
            CPU_COMPUTE
        ).toBe(EXPERTS);
      }
    });

    it('counts the table in full on an architecture that does not mark it, even with lazy mode on', () => {
      const model = modelWith(OVER, 'gemma3n');

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes - CPU_COMPUTE
      ).toBe(OVER + EXPERTS);
    });

    it('counts the table in full where the architecture is unknown', () => {
      const model = modelWith(OVER, null);

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes - CPU_COMPUTE
      ).toBe(OVER + EXPERTS);
    });

    it('counts a token table over the threshold in full, since llama.cpp never reads one lazily', () => {
      const model = modelWith(OVER, 'deepseek41', 'token_embd.weight');

      expect(
        computed({ model, configuration: { ...configuration, cpuMoe: true, loadMode: 'none', lazyMode: 'on' } })
          .hostResidentBytes - CPU_COMPUTE
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
      const scores = 2048 * 512 * 32 * 4 * 2;

      expect(unflashed.overheadBytes - computed().overheadBytes).toBe(MASK_BYTES + scores);
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

describe('llamaCppSizeVram against llama.cpp b12063', () => {
  const GIB = 1024 ** 3;
  const LAYER_ELEMENT_BYTES = 8 * 128 * 2 + 8 * 128 * 2;
  const CACHE_CELLS = 8192;
  const DEFAULT_PROMPT_CACHE = 8192 * 1024 * 1024;

  const withAttention = (attention: IEstimatedModel['attention'], overrides: Partial<IEstimatedModel> = {}) =>
    buildEstimatedModel({ attention, ...overrides });

  describe('KV width', () => {
    it('takes the key and value lengths the file states, over the embedding divided by its heads', () => {
      const model = withAttention({ keyLength: 64, valueLength: 256 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * 32 * (64 * 8 * 2 + 256 * 8 * 2));
    });

    it('charges an MLA model its compressed key alone', () => {
      const model = withAttention({ keyLength: 64, keyLengthMla: 32, valueLengthMla: 32 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * 32 * (64 * 8 * 2));
    });
  });

  describe('sliding windows', () => {
    const gemma = (attention: IEstimatedModel['attention']): IEstimatedModel =>
      withAttention(attention, { architecture: 'gemma3', layerCount: 12 });

    const WINDOW_CELLS = 1536;

    it("charges a window layer its window and a batch, on the architecture's default pattern", () => {
      const result = computed({ model: gemma({ slidingWindow: 1024 }) });

      expect(result.kvCacheBytes).toBe(4 * (2 * 2048 + 10 * WINDOW_CELLS) * LAYER_ELEMENT_BYTES);
    });

    it('follows a per-layer pattern the file states', () => {
      const pattern = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const result = computed({ model: gemma({ slidingWindow: 1024, slidingWindowPattern: pattern }) });

      expect(result.kvCacheBytes).toBe(4 * (10 * 2048 + 2 * WINDOW_CELLS) * LAYER_ELEMENT_BYTES);
    });

    it('takes the window lengths the file states for its window layers', () => {
      const result = computed({ model: gemma({ slidingWindow: 1024, keyLengthSwa: 64, valueLengthSwa: 32 }) });
      const windowElementBytes = 8 * (64 * 2 + 32 * 2);

      expect(result.kvCacheBytes).toBe(4 * (2 * 2048 * LAYER_ELEMENT_BYTES + 10 * WINDOW_CELLS * windowElementBytes));
    });

    it('reads a pattern stated as an interval', () => {
      const result = computed({ model: gemma({ slidingWindow: 1024, slidingWindowPattern: 3 }) });

      expect(result.kvCacheBytes).toBe(4 * (4 * 2048 + 8 * WINDOW_CELLS) * LAYER_ELEMENT_BYTES);
    });

    it('takes a pattern of zero as a window on every layer', () => {
      const result = computed({ model: gemma({ slidingWindow: 1024, slidingWindowPattern: 0 }) });

      expect(result.kvCacheBytes).toBe(4 * 12 * WINDOW_CELLS * LAYER_ELEMENT_BYTES);
    });

    it('starts the pattern on a dense layer where the architecture does', () => {
      const model = withAttention({ slidingWindow: 1024 }, { architecture: 'smallthinker', layerCount: 8 });

      expect(computed({ model }).kvCacheBytes).toBe(4 * (2 * 2048 + 6 * WINDOW_CELLS) * LAYER_ELEMENT_BYTES);
    });

    it("uses an architecture's own window where the file states none", () => {
      const model = buildEstimatedModel({ architecture: 'gemma2', layerCount: 4 });
      const result = computed({ model, configuration: { ...configuration, contextSize: 65536 } });

      expect(result.kvCacheBytes).toBe(4 * (2 * 16384 + 2 * 4608) * LAYER_ELEMENT_BYTES);
    });

    it('adds sliding-window checkpoints per slot to the host prompt cache', () => {
      const result = computed({ model: gemma({ slidingWindow: 1024 }) });

      expect(result.hostCacheBytes).toBe(DEFAULT_PROMPT_CACHE + 32 * 4 * 10 * WINDOW_CELLS * LAYER_ELEMENT_BYTES);
    });
  });

  describe('recurrent and hybrid models', () => {
    it('charges no KV to a layer with no key-value heads', () => {
      const headCountKvByLayer = [8, 0, 8, 0, ...Array<number>(28).fill(0)];
      const result = computed({ model: withAttention({ headCountKvByLayer }) });

      expect(result.kvCacheBytes).toBe(CACHE_CELLS * 2 * LAYER_ELEMENT_BYTES);
    });

    it('sizes a recurrent architecture with no attention heads at all', () => {
      const model = buildEstimatedModel({ architecture: 'mamba', headCount: 0, headCountKv: 0 });

      expect(computed({ model }).kvCacheBytes).toBe(0);
    });

    it('charges only the full-attention layers of an interleaved hybrid', () => {
      const model = buildEstimatedModel({ architecture: 'qwen3next', layerCount: 8 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * 2 * LAYER_ELEMENT_BYTES);
    });

    it('follows a recurrent-layer list the file states', () => {
      const model = withAttention({ recurrentLayers: [1, 0, 1, 0] }, { layerCount: 4 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * 2 * LAYER_ELEMENT_BYTES);
    });

    it('follows a full-attention interval the file states', () => {
      const model = withAttention({ fullAttentionInterval: 2 }, { layerCount: 8 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * 4 * LAYER_ELEMENT_BYTES);
    });

    it("sizes a stated head list's width from its first layer alone, as llama.cpp does", () => {
      const heads = { headCountByLayer: [0, 8, 0, 8], headCountKvByLayer: [0, 8, 0, 8] };
      const inferred = withAttention(heads, { layerCount: 4 });
      const stated = withAttention({ ...heads, keyLength: 128, valueLength: 128 }, { layerCount: 4 });

      expect(computed({ model: inferred }).kvCacheBytes).toBe(0);
      expect(computed({ model: stated }).kvCacheBytes).toBe(CACHE_CELLS * 2 * LAYER_ELEMENT_BYTES);
    });

    it('counts checkpoints of recurrent state for a hybrid', () => {
      const model = buildEstimatedModel({ architecture: 'qwen3next', layerCount: 8 });

      expect(computed({ model }).hostCacheBytes).toBe(DEFAULT_PROMPT_CACHE + 32 * 4 * 6 * 4096 * 64 * 4);
    });

    it('counts checkpoints of every layer of a recurrent model', () => {
      const model = buildEstimatedModel({ architecture: 'mamba', headCount: 0, headCountKv: 0, layerCount: 8 });

      expect(computed({ model }).hostCacheBytes).toBe(DEFAULT_PROMPT_CACHE + 32 * 4 * 8 * 4096 * 64 * 4);
    });
  });

  describe('context', () => {
    it('pads the context, then each sequence, to 256 cells', () => {
      const result = computed({ configuration: { ...configuration, contextSize: 8200 } });

      expect(result.kvCacheBytes).toBe(4 * 2304 * 32 * LAYER_ELEMENT_BYTES);
    });

    it('uses one trained context length per slot with an explicit split and context size zero', () => {
      const result = computed({ configuration: { ...configuration, contextSize: 0, tensorSplit: [1, 1] } });

      expect(result.kvCacheBytes).toBe(4 * 8192 * 32 * LAYER_ELEMENT_BYTES);
    });

    it('keeps the trained length in total in tensor mode, where fit never starts', () => {
      const result = computed({
        configuration: { ...configuration, contextSize: 0, splitMode: 'tensor' },
      });

      expect(result.kvCacheBytes).toBe(CACHE_CELLS * 32 * LAYER_ELEMENT_BYTES);
    });
  });

  describe('NextN layers', () => {
    const model = withAttention(
      { nextnLayerCount: 1 },
      { tensors: [{ name: 'blk.31.nextn.eh_proj.weight', sizeBytes: GIB }] }
    );

    it('counts neither their weights nor their cache unless draft-mtp loads them', () => {
      const result = computed({ model });

      expect(result.weightsBytes).toBe(model.sizeBytes - GIB);
      expect(result.kvCacheBytes).toBe(CACHE_CELLS * 31 * LAYER_ELEMENT_BYTES);
    });

    it('counts both once draft-mtp loads them', () => {
      const result = computed({ model, configuration: { ...configuration, speculativeType: 'draft-mtp' } });

      expect(result.weightsBytes).toBe(model.sizeBytes);
      expect(result.kvCacheBytes).toBe(CACHE_CELLS * 32 * LAYER_ELEMENT_BYTES);
    });
  });

  describe('RAM', () => {
    it('counts no prompt cache for a decision model unless one is set', () => {
      const model = withAttention({ decisionType: 'classify' });

      expect(computed({ model }).hostCacheBytes).toBe(0);
      expect(computed({ model, configuration: { ...configuration, promptCache: 2048 } }).hostCacheBytes).toBe(
        2048 * 1024 * 1024
      );
    });

    it('moves the KV cache to RAM under --no-kv-offload', () => {
      const result = computed({ configuration: { ...configuration, noKvOffload: true } });

      expect(result.kvCacheBytes).toBe(0);
      expect(result.hostResidentBytes).toBe(CACHE_CELLS * 32 * LAYER_ELEMENT_BYTES);
    });

    it('locks each shard from its start to its last host tensor under mmap+mlock', () => {
      const model = buildEstimatedModel({
        tensors: [
          { name: 'token_embd.weight', sizeBytes: GIB, offsetBytes: 40 * GIB, shard: 0 },
          { name: 'per_layer_token_embd.weight', sizeBytes: GIB, offsetBytes: 2 * GIB, shard: 1 },
        ],
      });
      const result = computed({ model, configuration: { ...configuration, loadMode: 'mmap+mlock' } });

      expect(result.hostResidentBytes).toBe(41 * GIB + 3 * GIB);
    });

    it('leaves a lazy table past the last locked tensor out of the range', () => {
      const model = buildEstimatedModel({
        architecture: 'gemma4',
        tensors: [
          { name: 'per_layer_token_embd.weight', sizeBytes: 5 * GIB, offsetBytes: 50 * GIB, shard: 0 },
          { name: 'token_embd.weight', sizeBytes: GIB, offsetBytes: GIB, shard: 0 },
        ],
      });
      const result = computed({ model, configuration: { ...configuration, loadMode: 'mmap+mlock' } });

      expect(result.hostResidentBytes).toBe(2 * GIB);
    });

    it('counts the host tensors alone where any of them has no offset', () => {
      const model = buildEstimatedModel({
        tensors: [
          { name: 'token_embd.weight', sizeBytes: GIB, offsetBytes: 40 * GIB, shard: 0 },
          { name: 'position_embd.weight', sizeBytes: GIB },
        ],
      });
      const result = computed({ model, configuration: { ...configuration, loadMode: 'mmap+mlock' } });

      expect(result.hostResidentBytes).toBe(2 * GIB);
    });

    it('keeps one copy of a mirrored cache in RAM under --no-kv-offload', () => {
      const model = buildEstimatedModel({ architecture: 'deepseek4' });
      const result = computed({
        model,
        deviceCount: 2,
        configuration: { ...configuration, splitMode: 'tensor', noKvOffload: true },
      });

      expect(result.hostResidentBytes).toBe(CACHE_CELLS * 32 * LAYER_ELEMENT_BYTES);
    });

    it('counts a compute buffer in RAM for experts held on the CPU', () => {
      const result = computed({ configuration: { ...configuration, cpuMoeLayers: 2 } });

      expect(result.hostResidentBytes).toBe(CPU_COMPUTE);
    });

    it('keeps the remaining input tensors off the cards, read by row or held whole as llama.cpp reads them', () => {
      const tensors = [
        { name: 'value_embd.weight', sizeBytes: GIB },
        { name: 'masked_embd_centroids.weight', sizeBytes: 2 * GIB },
      ];
      const result = computed({ model: buildEstimatedModel({ tensors, sizeBytes: 10 * GIB }) });

      expect(result.hostWeightsBytes).toBe(3 * GIB);
      expect(result.hostResidentBytes).toBe(2 * GIB);
    });

    it('holds the mask ordering whole and reads a mask table by row', () => {
      const tensors = [
        { name: 'mask_embd.weight', sizeBytes: GIB },
        { name: 'masked_embd_ordering', sizeBytes: 2 * GIB },
      ];
      const result = computed({ model: buildEstimatedModel({ tensors, sizeBytes: 10 * GIB }) });

      expect(result.hostWeightsBytes).toBe(3 * GIB);
      expect(result.hostResidentBytes).toBe(2 * GIB);
    });
  });

  describe('compressed and indexed caches', () => {
    it('charges DeepSeek 4 K-only caches: a raw window, and each ratio over its own cells, with an indexer on CSA', () => {
      const model = withAttention(
        { compressRatios: [4, 128], slidingWindow: 1024, keyLength: 128, indexerKeyLength: 64 },
        { architecture: 'deepseek4', layerCount: 2, headCountKv: 1 }
      );
      const rawWindow = 1536 * 128;
      const csa = 512 * 128 + 512 * 64;
      const hca = 256 * 128;

      expect(computed({ model }).kvCacheBytes).toBe(4 * 2 * (2 * rawWindow + csa + hca));
    });

    it('charges DeepSeek 4.1 its compressed key beside the indexer, with no separate indexer cache', () => {
      const model = withAttention(
        { compressRatios: [2, 1], slidingWindow: 1024, keyLength: 128, indexerKeyLength: 64 },
        { architecture: 'deepseek41', layerCount: 2, headCountKv: 1 }
      );

      expect(computed({ model }).kvCacheBytes).toBe(4 * 2 * (2 * 1536 * 128 + 1024 * 192 + 2048 * 192));
    });

    it('adds an indexer key cache on the architectures that have one', () => {
      const model = withAttention({ indexerKeyLength: 64 }, { architecture: 'glm-dsa', layerCount: 2 });

      expect(computed({ model }).kvCacheBytes).toBe(CACHE_CELLS * (2 * LAYER_ELEMENT_BYTES + 2 * 64 * 2));
    });

    it("copies HRM's weights to every card in tensor mode, not its KV cache alone", () => {
      const model = buildEstimatedModel({ architecture: 'hrm_text', sizeBytes: 10 * GIB });
      const devices = [
        { deviceKey: 'GPU-0', totalBytes: null },
        { deviceKey: 'GPU-1', totalBytes: null },
      ];

      const result = computed({
        model,
        deviceCount: 2,
        devices,
        configuration: { ...configuration, splitMode: 'tensor' },
      });

      expect(result.weightsBytes).toBe(20 * GIB);
    });
  });
});
