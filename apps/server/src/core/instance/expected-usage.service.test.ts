import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendId, GIB, IInstancePins, ModelType } from '@libs/backends';
import { EstimateInputSource, fractionOfDevices, IVramEstimate, IVramEstimateInput } from '@libs/backends/runtime';
import { ExpectedUsageSource } from '@libs/dto';

import { DeploymentService } from '@/core/deployment/deployment.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { ExpectedUsageService, IExpectedUsage } from '@/core/instance/expected-usage.service';
import { InstanceLaunchService } from '@/core/instance/instance-launch.service';
import { MeasuredVramService } from '@/core/instance/measured-vram.service';
import { ModelReferenceService } from '@/core/model/model-reference.service';

import { IResolvedModelReference } from '@/core/model/model-reference';
import { buildDeployment } from '@/test/deployment.factory';
import { buildModel } from '@/test/model.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const stubEstimate = vi.hoisted(() => ({
  estimator: null as ((input: IVramEstimateInput) => IVramEstimate) | null,
}));

vi.mock('@libs/backends/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@libs/backends/runtime')>();

  return {
    ...actual,
    backendFor: (backend: BackendId) => {
      const resolved = actual.backendFor(backend);
      const estimator = stubEstimate.estimator;

      if (estimator === null) {
        return resolved;
      }

      return {
        ...resolved,
        sizeVram: (input: IVramEstimateInput) => ({ ...resolved.sizeVram(input), estimate: estimator(input) }),
      };
    },
  };
});

const MODEL = {
  sizeBytes: 4_000_000_000,
  architecture: 'llama',
  quantisation: 'Q4_K_M',
  layerCount: 32,
  embeddingLength: 4096,
  headCount: 32,
  headCountKv: 8,
  contextLength: 8192,
};

const MIB = 1024 * 1024;

const ONE_CARD: IInstancePins = { cpu: false, gpus: ['GPU-a'] };

const OFFLOADED_EXPERTS = {
  ...MODEL,
  quantisationMixed: false,
  tensors: [{ name: 'blk.0.ffn_up_exps.weight', sizeBytes: 900 * MIB }],
};

const CONFIGURATION = { contextSize: 8192, ubatchSize: 512, cacheTypeK: 'f16', cacheTypeV: 'f16', replicas: 2 };

describe('ExpectedUsageService', () => {
  let backend: BackendId;
  let configuration: Record<string, unknown>;
  let model: typeof MODEL | Record<string, unknown>;
  let remembered: number | null;
  let rememberedFor: ReturnType<typeof vi.fn>;
  let cardTotals: Map<string, number | null>;
  let references: IResolvedModelReference[];
  let expectedUsageService: ExpectedUsageService;

  const expectedFor = (deployment = buildDeployment(), pins: IInstancePins = ONE_CARD): Promise<IExpectedUsage> =>
    expectedUsageService.expectedFor(deployment, TEST_NODE_ID, pins);

  beforeEach(() => {
    backend = BackendId.LLAMA_CPP;
    configuration = CONFIGURATION;
    model = MODEL;
    remembered = null;
    rememberedFor = vi.fn(() => Promise.resolve(remembered));
    cardTotals = new Map([
      ['GPU-a', 24 * GIB],
      ['GPU-b', 24 * GIB],
    ]);
    references = [];
    stubEstimate.estimator = null;

    expectedUsageService = new ExpectedUsageService(
      {
        getBackend: () => backend,
        resolveConfiguration: () => ({ configuration }),
      } as unknown as DeploymentService,
      {
        findByNodeId: vi.fn(() =>
          Promise.resolve([
            { deviceKey: 'GPU-a', memoryTotalBytes: cardTotals.get('GPU-a') },
            { deviceKey: 'GPU-b', memoryTotalBytes: cardTotals.get('GPU-b') },
          ])
        ),
      } as unknown as GpuService,
      { describeModel: vi.fn(() => model) } as unknown as InstanceLaunchService,
      { rememberedFor } as unknown as MeasuredVramService,
      { resolve: vi.fn(() => Promise.resolve(references)) } as unknown as ModelReferenceService
    );
  });

  it("takes the adapter's estimate where nothing better is known", async () => {
    const usage = await expectedFor();

    expect(usage).toMatchObject({ known: true, source: ExpectedUsageSource.ESTIMATED });
  });

  it('takes the remembered measured figure ahead of the estimate', async () => {
    remembered = 9 * 1024 * MIB;

    const usage = await expectedFor();

    expect(usage).toEqual({
      known: true,
      bytes: 9 * 1024 * MIB,
      source: ExpectedUsageSource.MEASURED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
      hostCacheBytes: 8192 * MIB,
      cardShares: null,
    });
  });

  it("asks for the figure remembered for the deployment's configuration and pins", async () => {
    const pins = { cpu: false, gpus: ['GPU-a', 'GPU-b'] };

    await expectedFor(buildDeployment({ configurationRevision: 'raised-context' }), pins);

    expect(rememberedFor).toHaveBeenCalledWith('raised-context', pins);
  });

  it('estimates for the pinned card count, counting the per-card overhead on each', async () => {
    const one = await expectedFor();
    const two = await expectedFor(buildDeployment(), { cpu: false, gpus: ['GPU-a', 'GPU-b'] });

    // Each card: a 384 MiB runtime, 128 MiB of activations, and an 8 MiB mask held four times once pipelined.
    expect(one.known && two.known && two.bytes - one.bytes).toBe(2 * (384 + 128 + 32) * MIB - (384 + 128 + 8) * MIB);
  });

  it('leaves out the tensors the configuration keeps in host memory, and says how much', async () => {
    const pins = { cpu: false, gpus: ['GPU-a'] };
    const deployment = buildDeployment({ model: buildModel({ ggufMetadata: OFFLOADED_EXPERTS }) });

    const whole = await expectedFor(deployment, pins);

    configuration = { ...CONFIGURATION, tensorOverrides: ['exps=CPU'] };

    const reduced = await expectedFor(deployment, pins);

    expect(reduced).toMatchObject({
      known: true,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 900 * MIB,
      hostResidentBytes: 900 * MIB,
    });
    expect(whole.known && reduced.known && whole.bytes - reduced.bytes).toBe(900 * MIB);
  });

  it('leaves an n-gram table out of what host memory has to hold, since it is read from the mapped file', async () => {
    const ngram = { ...OFFLOADED_EXPERTS, tensors: [{ name: 'per_layer_token_embd.weight', sizeBytes: 900 * MIB }] };
    const deployment = buildDeployment({ model: buildModel({ ggufMetadata: ngram }) });

    const usage = await expectedFor(deployment);

    expect(usage).toMatchObject({ known: true, hostWeightsBytes: 900 * MIB, hostResidentBytes: 0 });
  });

  it('takes the host figures from the estimate beside a measured figure, which cannot see them', async () => {
    remembered = 9 * 1024 * MIB;
    configuration = { ...CONFIGURATION, tensorOverrides: ['exps=CPU'] };

    const deployment = buildDeployment({ model: buildModel({ ggufMetadata: OFFLOADED_EXPERTS }) });
    const usage = await expectedFor(deployment);

    expect(usage).toEqual({
      known: true,
      bytes: 9 * 1024 * MIB,
      source: ExpectedUsageSource.MEASURED,
      hostWeightsBytes: 900 * MIB,
      hostResidentBytes: 900 * MIB,
      hostCacheBytes: 8192 * MIB,
      cardShares: null,
    });
  });

  it("takes each card's share from the backend, whatever source sized the deployment", async () => {
    remembered = 9 * GIB;
    configuration = { ...CONFIGURATION, tensorSplit: [3, 1] };

    const usage = await expectedFor(buildDeployment(), { cpu: false, gpus: ['GPU-a', 'GPU-b'] });
    const [first, second] = (usage.known ? usage.cardShares : null) ?? [];

    expect(usage).toMatchObject({ known: true, source: ExpectedUsageSource.MEASURED });
    expect(first).toBeGreaterThan(second);
  });

  it('takes no host figures beside a measured figure where the estimate cannot be made', async () => {
    remembered = 9 * 1024 * MIB;
    configuration = { ...CONFIGURATION, contextSize: undefined, tensorOverrides: ['exps=CPU'] };

    const deployment = buildDeployment({ model: buildModel({ ggufMetadata: OFFLOADED_EXPERTS }) });
    const usage = await expectedFor(deployment);

    expect(usage).toMatchObject({ source: ExpectedUsageSource.MEASURED, hostWeightsBytes: 0, hostResidentBytes: 0 });
  });

  it('still counts the prompt cache beside a measured figure where the estimate cannot be made', async () => {
    remembered = 9 * 1024 * MIB;
    configuration = { ...CONFIGURATION, contextSize: undefined, promptCache: 2048 };

    await expect(expectedFor()).resolves.toMatchObject({
      source: ExpectedUsageSource.MEASURED,
      hostResidentBytes: 0,
      hostCacheBytes: 2048 * MIB,
    });
  });

  it('preserves declared VRAM usage and GPU shares in tensor mode', async () => {
    configuration = { ...CONFIGURATION, vramGib: 10, splitMode: 'tensor' };

    const usage = await expectedFor(buildDeployment(), { cpu: true, gpus: ['GPU-a', 'GPU-b'] });

    expect(usage).toMatchObject({
      source: ExpectedUsageSource.DECLARED,
      bytes: 10 * 1024 * MIB,
      cardsOnlyReason: 'Tensor mode requires the whole model in VRAM',
    });
    expect(usage.known && usage.cardShares?.[0]).toBe(usage.known && usage.cardShares?.[1]);
  });

  it('counts the prompt cache beside a declared figure', async () => {
    configuration = { ...CONFIGURATION, vramGib: 10, promptCache: 1024 };

    await expect(expectedFor()).resolves.toMatchObject({
      source: ExpectedUsageSource.DECLARED,
      hostCacheBytes: 1024 * MIB,
    });
  });

  it("answers with the adapter's missing inputs where it cannot estimate", async () => {
    model = { ...MODEL, layerCount: null };
    configuration = { ...CONFIGURATION, contextSize: undefined };

    const usage = await expectedFor();

    expect(usage).toEqual({
      known: false,
      missing: expect.arrayContaining([
        { source: EstimateInputSource.MODEL_METADATA, field: 'layerCount' },
        { source: EstimateInputSource.CONFIGURATION, field: 'contextSize' },
      ]) as unknown,
    });
  });

  it("counts a projector's bytes in the estimate", async () => {
    const without = await expectedFor();

    references = [
      {
        field: 'mmproj',
        fingerprint: 'b'.repeat(64),
        label: 'Projector',
        modelType: buildModel().type,
        model: buildModel({ sizeBytes: 800 * MIB }),
      },
    ];

    const projected = await expectedFor();

    expect(without.known && projected.known && projected.bytes - without.bytes).toBe(800 * MIB);
  });

  describe('a draft model', () => {
    const DRAFT_BYTES = 8_000_000_000;

    const DRAFT_TOTAL_BYTES = DRAFT_BYTES + 33_554_432 + 75_497_472;

    beforeEach(() => {
      references = [
        {
          field: 'draftModel',
          fingerprint: 'c'.repeat(64),
          label: 'Draft model',
          modelType: ModelType.DRAFT,
          model: buildModel({
            type: ModelType.DRAFT,
            sizeBytes: DRAFT_BYTES,
            ggufMetadata: {
              architecture: 'dflash',
              quantisation: 'Q8_0',
              quantisationMixed: false,
              layerCount: 8,
              embeddingLength: 2048,
              headCount: 16,
              headCountKv: 1,
              contextLength: null,
              tensors: null,
            },
          }),
        },
      ];
    });

    it('adds its file, context and KV from its own metadata to the estimate', async () => {
      const drafted = await expectedFor();

      references = [];

      const without = await expectedFor();

      expect(drafted.known && without.known ? drafted.bytes - without.bytes : null).toBe(DRAFT_TOTAL_BYTES);
    });

    it('leaves a measured figure as it is, which already holds the draft', async () => {
      remembered = 9 * GIB;

      await expect(expectedFor()).resolves.toMatchObject({ bytes: 9 * GIB, source: ExpectedUsageSource.MEASURED });
    });

    it('leaves a declared figure as it is', async () => {
      configuration = { ...CONFIGURATION, vramGib: 6 };

      await expect(expectedFor()).resolves.toMatchObject({ bytes: 6 * GIB, source: ExpectedUsageSource.DECLARED });
    });
  });

  describe('a figure the operator declared', () => {
    beforeEach(() => {
      configuration = { ...CONFIGURATION, vramGib: 6 };
    });

    it('admits on it ahead of the estimate', async () => {
      await expect(expectedFor()).resolves.toMatchObject({ bytes: 6 * GIB, source: ExpectedUsageSource.DECLARED });
    });

    it('outranks a remembered measured figure, since the operator may know of a change it has not seen', async () => {
      remembered = 9 * GIB;

      await expect(expectedFor()).resolves.toMatchObject({ bytes: 6 * GIB, source: ExpectedUsageSource.DECLARED });
    });

    it('sizes a deployment no estimate covers', async () => {
      model = { ...MODEL, layerCount: null };

      await expect(expectedFor()).resolves.toMatchObject({ bytes: 6 * GIB, source: ExpectedUsageSource.DECLARED });
    });
  });

  describe('a backend sized by a stated size', () => {
    it('takes the size whole on its one card, so the ledger can refuse a card short of it', async () => {
      backend = BackendId.VLLM_OMNI;
      configuration = { gpuMemoryGib: 30 };

      await expect(expectedFor()).resolves.toMatchObject({
        known: true,
        bytes: 30 * GIB,
        source: ExpectedUsageSource.CONFIGURED,
        cardShares: [1],
      });
    });
  });

  describe('a backend configured to take a share of each card', () => {
    beforeEach(() => {
      stubEstimate.estimator = input => fractionOfDevices(input, 0.5);
    });

    it("takes the share of each card's total, labelled as configured", async () => {
      await expect(expectedFor()).resolves.toMatchObject({ bytes: 12 * GIB, source: ExpectedUsageSource.CONFIGURED });
    });

    it('takes each pinned card on its own total, whatever else the node holds', async () => {
      cardTotals = new Map([
        ['GPU-a', 24 * GIB],
        ['GPU-b', 48 * GIB],
      ]);

      await expect(expectedFor(buildDeployment(), { cpu: false, gpus: ['GPU-b'] })).resolves.toMatchObject({
        bytes: 24 * GIB,
      });
    });

    it('outranks a declared figure', async () => {
      configuration = { ...CONFIGURATION, vramGib: 6 };

      await expect(expectedFor()).resolves.toMatchObject({ source: ExpectedUsageSource.CONFIGURED });
    });

    it('is not replaced by a remembered figure, which may have been measured on a card of another size', async () => {
      remembered = 9 * GIB;

      await expect(expectedFor()).resolves.toMatchObject({ bytes: 12 * GIB, source: ExpectedUsageSource.CONFIGURED });
    });

    it('names a card that has not reported its total, rather than sizing the deployment some other way', async () => {
      cardTotals = new Map([
        ['GPU-a', null],
        ['GPU-b', 24 * GIB],
      ]);
      remembered = 9 * GIB;
      configuration = { ...CONFIGURATION, vramGib: 6 };

      await expect(expectedFor()).resolves.toEqual({
        known: false,
        missing: [{ source: EstimateInputSource.DEVICE, field: 'GPU-a' }],
      });
    });
  });
});
