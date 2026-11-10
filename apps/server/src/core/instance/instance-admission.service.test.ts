import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GIB, LaunchMode } from '@libs/backends';
import { EstimateInputSource } from '@libs/backends/runtime';
import { ExpectedUsageSource } from '@libs/dto';

import { ExpectedUsageService } from '@/core/instance/expected-usage.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { INodePlacement } from '@/core/instance/instance-launch.service';
import { FitRefusal, IFitReport, VramLedgerService } from '@/core/ledger/vram-ledger.service';

import { buildDeployment, TEST_DEPLOYMENT_ID } from '@/test/deployment.factory';
import { TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const ON_GPU: INodePlacement = { nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: ['GPU-a'] }, problem: null };
const OFFLOADED: INodePlacement = { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: ['GPU-a'] }, problem: null };
const ON_CPU: INodePlacement = { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null };

const fitReport = (overrides: Partial<IFitReport> = {}): IFitReport => ({
  launchMode: LaunchMode.GPU_ONLY,
  expectedBytes: 20 * GIB,
  cards: [
    {
      deviceKey: 'GPU-a',
      totalBytes: 24 * GIB,
      usedBytes: 8 * GIB,
      predictedBytes: 2 * GIB,
      headroomBytes: GIB,
      freeBytes: 14 * GIB,
      neededBytes: null,
    },
  ],
  hostFreeBytes: null,
  availableBytes: 13 * GIB,
  hostWeights: null,
  shortCard: null,
  refusal: null,
  ...overrides,
});

describe('InstanceAdmissionService', () => {
  let expectedUsageService: { expectedFor: ReturnType<typeof vi.fn> };
  let vramLedgerService: {
    check: ReturnType<typeof vi.fn>;
    checkReleasing: ReturnType<typeof vi.fn>;
    admit: ReturnType<typeof vi.fn>;
  };
  let instanceAdmissionService: InstanceAdmissionService;

  beforeEach(() => {
    expectedUsageService = {
      expectedFor: vi.fn().mockResolvedValue({
        known: true,
        bytes: 20 * GIB,
        source: ExpectedUsageSource.ESTIMATED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
        hostCacheBytes: 0,
        cardShares: null,
      }),
    };
    vramLedgerService = {
      check: vi.fn().mockResolvedValue(fitReport()),
      checkReleasing: vi.fn().mockResolvedValue(fitReport()),
      admit: vi.fn().mockResolvedValue(fitReport()),
    };

    instanceAdmissionService = new InstanceAdmissionService(
      expectedUsageService as unknown as ExpectedUsageService,
      vramLedgerService as unknown as VramLedgerService
    );
  });

  it('admits against the ledger under the instance key, with the expected figure', async () => {
    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toEqual({
      problem: null,
      expected: expect.objectContaining({ bytes: 20 * GIB, source: ExpectedUsageSource.ESTIMATED }) as unknown,
    });
    expect(vramLedgerService.admit).toHaveBeenCalledWith(
      TEST_INSTANCE_KEY,
      TEST_DEPLOYMENT_ID,
      TEST_NODE_ID,
      ON_GPU.pins,
      { expectedBytes: 20 * GIB, hostBytes: 0, hostCacheBytes: 0, cardShares: null }
    );
  });

  describe("a deployment's own margin", () => {
    const WITH_MARGIN = expect.objectContaining({ headroomBytes: GIB / 2 }) as unknown;

    beforeEach(() => {
      expectedUsageService.expectedFor.mockResolvedValue({
        known: true,
        bytes: 20 * GIB,
        source: ExpectedUsageSource.ESTIMATED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
        hostCacheBytes: 0,
        cardShares: null,
        headroomBytes: GIB / 2,
      });
    });

    it('reaches the ledger on a start', async () => {
      await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

      expect(vramLedgerService.admit).toHaveBeenCalledWith(
        TEST_INSTANCE_KEY,
        TEST_DEPLOYMENT_ID,
        TEST_NODE_ID,
        ON_GPU.pins,
        WITH_MARGIN
      );
    });

    it('reaches the ledger on an eviction plan', async () => {
      await instanceAdmissionService.checkReleasing(buildDeployment(), ON_GPU, [TEST_INSTANCE_KEY]);

      expect(vramLedgerService.checkReleasing).toHaveBeenCalledWith(TEST_NODE_ID, ON_GPU.pins, WITH_MARGIN, [
        TEST_INSTANCE_KEY,
      ]);
    });
  });

  it('admits a CPU-only instance without asking the ledger or for an estimate', async () => {
    await expect(instanceAdmissionService.admit(buildDeployment(), ON_CPU, TEST_INSTANCE_KEY)).resolves.toEqual({
      problem: null,
    });
    expect(expectedUsageService.expectedFor).not.toHaveBeenCalled();
    expect(vramLedgerService.admit).not.toHaveBeenCalled();
  });

  it('refuses a deployment with no expected figure, naming what the adapter is missing', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: false,
      missing: [
        { source: EstimateInputSource.MODEL_METADATA, field: 'layerCount' },
        { source: EstimateInputSource.CONFIGURATION, field: 'contextSize' },
      ],
    });

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe(
      "Cannot estimate memory use. Missing: the model's layerCount, `contextSize`. " +
        'Set `vramGib` to specify GPU memory use'
    );
    expect(vramLedgerService.admit).not.toHaveBeenCalled();
  });

  it('names a pinned card that has not reported its total', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: false,
      missing: [{ source: EstimateInputSource.DEVICE, field: 'GPU-a' }],
    });

    const admission = await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

    expect(admission.problem).toBe('Cannot estimate memory use. Missing: total memory for GPU-a (not reported)');
  });

  it('names what the deployment needs where the pinned GPUs are too full, carrying the figures', async () => {
    const refused = fitReport({ refusal: FitRefusal.TOO_LARGE });

    vramLedgerService.admit.mockResolvedValue(refused);

    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject({
      problem: 'Not enough GPU memory for 20.0 GiB',
      capacity: refused,
    });
  });

  it('names the card short of its share where the pool has room but that card does not', async () => {
    const report = fitReport({ shortCard: 'GPU-a', refusal: FitRefusal.CARD_TOO_SMALL });

    report.cards[0].neededBytes = 15 * GIB;
    vramLedgerService.admit.mockResolvedValue(report);

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('Not enough memory on GPU-a for 15.0 GiB');
  });

  it('names a GPU with insufficient total memory, with its total, however much is free on it', async () => {
    const report = fitReport({ shortCard: 'GPU-a', refusal: FitRefusal.CARD_OUTGROWN });

    report.cards[0].totalBytes = 8 * GIB;
    vramLedgerService.admit.mockResolvedValue(report);

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('GPU memory requirement exceeds GPU-a capacity (8.0 GiB)');
  });

  it('carries the share a card would take into the event detail where it is known', () => {
    const report = fitReport();

    report.cards[0].neededBytes = 15 * GIB;

    expect(instanceAdmissionService.capacityDetail(report).cards).toBe(
      'GPU-a: total 24.0 GiB, used 8.0 GiB, predicted 2.0 GiB, headroom 1.0 GiB, free 14.0 GiB, needed 15.0 GiB'
    );
  });

  it('names system memory in the pool of an instance offloading to the CPU', async () => {
    vramLedgerService.admit.mockResolvedValue(
      fitReport({ launchMode: LaunchMode.CPU_OFFLOAD, refusal: FitRefusal.TOO_LARGE })
    );

    const admission = await instanceAdmissionService.admit(buildDeployment(), OFFLOADED, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('Not enough VRAM and RAM for 20.0 GiB');
  });

  it('names the host weights in the pool need of an instance offloading to the CPU', async () => {
    const hostWeights = { neededBytes: 5 * GIB, cacheBytes: 0, predictedBytes: 0, freeBytes: 16 * GIB };

    vramLedgerService.admit.mockResolvedValue(
      fitReport({ launchMode: LaunchMode.CPU_OFFLOAD, hostWeights, refusal: FitRefusal.TOO_LARGE })
    );

    const admission = await instanceAdmissionService.admit(buildDeployment(), OFFLOADED, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('Not enough VRAM and RAM for 25.0 GiB');
  });

  describe('previewReleasing', () => {
    it('counts memory released by the specified instances', async () => {
      await instanceAdmissionService.previewReleasing(buildDeployment(), ON_GPU, [TEST_INSTANCE_KEY]);

      expect(vramLedgerService.checkReleasing).toHaveBeenCalledWith(
        TEST_NODE_ID,
        ON_GPU.pins,
        expect.objectContaining({ expectedBytes: 20 * GIB }),
        [TEST_INSTANCE_KEY]
      );
    });

    it('returns the capacity refusal from the ledger', async () => {
      vramLedgerService.checkReleasing.mockResolvedValue(fitReport({ refusal: FitRefusal.TOO_LARGE }));

      await expect(
        instanceAdmissionService.previewReleasing(buildDeployment(), ON_GPU, [TEST_INSTANCE_KEY])
      ).resolves.toMatchObject({ problem: 'Not enough GPU memory for 20.0 GiB' });
    });

    it('reports missing data needed to estimate memory usage', async () => {
      expectedUsageService.expectedFor.mockResolvedValue({
        known: false,
        missing: [{ source: EstimateInputSource.CONFIGURATION, field: 'contextSize' }],
      });

      const admission = await instanceAdmissionService.previewReleasing(buildDeployment(), ON_GPU, [TEST_INSTANCE_KEY]);

      expect(admission.problem).toContain('`contextSize`');
      expect(vramLedgerService.checkReleasing).not.toHaveBeenCalled();
    });

    it('allows CPU-only placement', async () => {
      await expect(
        instanceAdmissionService.previewReleasing(buildDeployment(), ON_CPU, [TEST_INSTANCE_KEY])
      ).resolves.toEqual({ problem: null });
    });
  });

  describe('a launch that uses live free memory for placement', () => {
    it('returns a loading refusal with capacity figures', async () => {
      vramLedgerService.check.mockResolvedValue(fitReport({ refusal: FitRefusal.LOAD_IN_PROGRESS }));

      await expect(instanceAdmissionService.preview(buildDeployment(), ON_GPU)).resolves.toMatchObject({
        problem: expect.stringContaining('Waiting for another model') as string,
        capacity: { refusal: FitRefusal.LOAD_IN_PROGRESS },
      });
    });

    it('passes the sizing restrictions to the ledger', async () => {
      expectedUsageService.expectedFor.mockResolvedValue({
        known: true,
        bytes: 20 * GIB,
        source: ExpectedUsageSource.ESTIMATED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
        hostCacheBytes: 0,
        cardShares: null,
        balancedOnFreeMemory: true,
        headroomBytes: GIB / 2,
      });

      await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

      expect(vramLedgerService.check).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ balancedOnFreeMemory: true, headroomBytes: GIB / 2 })
      );
    });
  });

  describe('a launch without RAM offloading', () => {
    const REASON = 'Tensor mode requires the whole model in VRAM';
    const heldCard = { ...fitReport().cards[0], neededBytes: 15 * GIB };

    it.each([
      [
        'the pool',
        fitReport({ cardsOnlyReason: REASON, refusal: FitRefusal.TOO_LARGE }),
        `${REASON}. Not enough GPU memory for 20.0 GiB`,
      ],
      [
        'one card',
        fitReport({
          cardsOnlyReason: REASON,
          cards: [heldCard],
          shortCard: 'GPU-a',
          refusal: FitRefusal.CARD_TOO_SMALL,
        }),
        `${REASON}. Not enough memory on GPU-a for 15.0 GiB`,
      ],
      [
        'a GPU with insufficient total memory',
        fitReport({ cardsOnlyReason: REASON, shortCard: 'GPU-a', refusal: FitRefusal.CARD_OUTGROWN }),
        `${REASON}. GPU memory requirement exceeds GPU-a capacity (24.0 GiB)`,
      ],
    ])('includes tensor mode and the memory required by %s regardless of free memory', async (_, refused, problem) => {
      for (const freeBytes of [GIB, 2 * GIB]) {
        const cards = refused.cards.map(card => ({ ...card, freeBytes }));

        vramLedgerService.admit.mockResolvedValue({ ...refused, cards });

        await expect(
          instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)
        ).resolves.toMatchObject({ problem });
      }
    });

    it('omits the tensor-mode reason from RAM refusals', async () => {
      vramLedgerService.admit.mockResolvedValue(
        fitReport({
          cardsOnlyReason: REASON,
          hostWeights: { neededBytes: 8 * GIB, cacheBytes: 8 * GIB, predictedBytes: 0, freeBytes: GIB },
          refusal: FitRefusal.HOST_MEMORY,
        })
      );

      await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject(
        {
          problem: 'Not enough RAM for up to 8.0 GiB of prompt cache and checkpoints',
        }
      );
    });

    it('passes the offloading restriction to the ledger', async () => {
      expectedUsageService.expectedFor.mockResolvedValue({
        known: true,
        bytes: 20 * GIB,
        source: ExpectedUsageSource.DECLARED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
        hostCacheBytes: 0,
        cardShares: [1, 1],
        cardsOnlyReason: REASON,
      });

      await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

      expect(vramLedgerService.check).toHaveBeenCalledWith(
        TEST_NODE_ID,
        ON_GPU.pins,
        expect.objectContaining({ expectedBytes: 20 * GIB, cardShares: [1, 1], cardsOnlyReason: REASON })
      );
    });
  });

  it('names the weights kept in system memory where the node has too little free', async () => {
    const refused = fitReport({
      hostWeights: { neededBytes: 30 * GIB, cacheBytes: 0, predictedBytes: 0, freeBytes: 12 * GIB },
      refusal: FitRefusal.HOST_MEMORY,
    });

    vramLedgerService.admit.mockResolvedValue(refused);

    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject({
      problem: 'Not enough RAM for 30.0 GiB of model weights',
      capacity: refused,
    });
  });

  it.each([
    [
      'weights and cache',
      38 * GIB,
      'Not enough RAM for 30.0 GiB of model weights and up to 8.0 GiB of prompt cache and checkpoints',
    ],
    ['a cache alone', 8 * GIB, 'Not enough RAM for up to 8.0 GiB of prompt cache and checkpoints'],
  ])('names %s apart in a host-memory refusal, whatever is free', async (_, neededBytes, problem) => {
    for (const freeBytes of [GIB, 2 * GIB]) {
      vramLedgerService.admit.mockResolvedValue(
        fitReport({
          hostWeights: { neededBytes, cacheBytes: 8 * GIB, predictedBytes: 0, freeBytes },
          refusal: FitRefusal.HOST_MEMORY,
        })
      );

      await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject(
        { problem }
      );
    }
  });

  it('counts the prompt cache in what an offloading pool has to hold', async () => {
    vramLedgerService.admit.mockResolvedValue(
      fitReport({
        launchMode: LaunchMode.CPU_OFFLOAD,
        expectedBytes: 20 * GIB,
        hostWeights: { neededBytes: 8 * GIB, cacheBytes: 8 * GIB, predictedBytes: 0, freeBytes: 4 * GIB },
        refusal: FitRefusal.TOO_LARGE,
      })
    );

    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject({
      problem: 'Not enough VRAM and RAM for 28.0 GiB',
    });
  });

  it('puts the cache the deployment was sized with to the ledger apart from its weights', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
      hostCacheBytes: 8 * GIB,
      cardShares: null,
    });

    await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

    expect(vramLedgerService.check).toHaveBeenCalledWith(TEST_NODE_ID, ON_GPU.pins, {
      expectedBytes: 20 * GIB,
      hostBytes: 0,
      hostCacheBytes: 8 * GIB,
      cardShares: null,
    });
  });

  it('checks the host weights the estimate says host memory has to hold', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 35 * GIB,
      hostResidentBytes: 3 * GIB,
      hostCacheBytes: 0,
      cardShares: null,
    });

    await instanceAdmissionService.preview(buildDeployment(), ON_GPU);
    await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    const admitted = { expectedBytes: 20 * GIB, hostBytes: 3 * GIB, hostCacheBytes: 0, cardShares: null };

    expect(vramLedgerService.check).toHaveBeenCalledWith(TEST_NODE_ID, ON_GPU.pins, admitted);
    expect(vramLedgerService.admit).toHaveBeenCalledWith(
      TEST_INSTANCE_KEY,
      TEST_DEPLOYMENT_ID,
      TEST_NODE_ID,
      ON_GPU.pins,
      admitted
    );
  });

  it('says a node that has not reported cannot yet take a start', async () => {
    vramLedgerService.admit.mockResolvedValue(fitReport({ cards: [], refusal: FitRefusal.NO_TELEMETRY }));

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('No GPU memory readings received from this node');
  });

  it('previews through the ledger check, which holds nothing', async () => {
    vramLedgerService.check.mockResolvedValue(fitReport({ refusal: FitRefusal.UNMEASURED_CARD }));

    const admission = await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

    expect(admission.problem).toBe('Memory readings are missing for a selected GPU');
    expect(vramLedgerService.admit).not.toHaveBeenCalled();
  });

  it('previews with the expected figure and its source, whether or not the node has room', async () => {
    const expected = {
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
      hostCacheBytes: 0,
    };

    await expect(instanceAdmissionService.preview(buildDeployment(), ON_GPU)).resolves.toMatchObject({
      problem: null,
      expected,
    });

    vramLedgerService.check.mockResolvedValue(fitReport({ refusal: FitRefusal.TOO_LARGE }));

    await expect(instanceAdmissionService.preview(buildDeployment(), ON_GPU)).resolves.toMatchObject({ expected });
  });

  it('carries the figures of a node that has room, so a preview can say what is left beside its verdict', async () => {
    await expect(instanceAdmissionService.preview(buildDeployment(), ON_GPU)).resolves.toMatchObject({
      problem: null,
      capacity: fitReport(),
    });
  });

  it('expects nothing of a placement on the CPU alone, or of a deployment no source can size', async () => {
    await expect(instanceAdmissionService.expectedFor(buildDeployment(), ON_CPU)).resolves.toBeNull();
    expect(expectedUsageService.expectedFor).not.toHaveBeenCalled();

    expectedUsageService.expectedFor.mockResolvedValue({ known: false, missing: [] });

    await expect(instanceAdmissionService.expectedFor(buildDeployment(), ON_GPU)).resolves.toBeNull();
  });

  it('sizes a placement offloading to the CPU, since it still takes cards', async () => {
    await expect(instanceAdmissionService.expectedFor(buildDeployment(), OFFLOADED)).resolves.toEqual({
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
      hostCacheBytes: 0,
      cardShares: null,
    });
  });

  it('leaves out of the event detail what a node that has not reported cannot say', () => {
    const report = fitReport({ cards: [], availableBytes: null, refusal: FitRefusal.NO_TELEMETRY });

    expect(instanceAdmissionService.capacityDetail(report)).toEqual({ expectedBytes: 20 * GIB });
  });

  it('flattens the figures into an event detail, a figure it does not have reading as a dash', () => {
    const report = fitReport();

    report.cards[0].usedBytes = null;
    report.cards[0].freeBytes = null;

    expect(instanceAdmissionService.capacityDetail(report)).toEqual({
      expectedBytes: 20 * GIB,
      availableBytes: 13 * GIB,
      cards: 'GPU-a: total 24.0 GiB, used -, predicted 2.0 GiB, headroom 1.0 GiB, free -',
    });
  });

  it('carries the prompt cache into the event detail beside the total', () => {
    const report = fitReport({
      hostWeights: { neededBytes: 38 * GIB, cacheBytes: 8 * GIB, predictedBytes: 0, freeBytes: GIB },
    });

    expect(instanceAdmissionService.capacityDetail(report)).toMatchObject({
      hostNeededBytes: 38 * GIB,
      hostCacheBytes: 8 * GIB,
      hostAvailableBytes: GIB,
    });
  });

  it('carries the host weights and what is free for them into the event detail', () => {
    const report = fitReport({
      hostWeights: { neededBytes: 30 * GIB, cacheBytes: 0, predictedBytes: 2 * GIB, freeBytes: 12 * GIB },
    });

    expect(instanceAdmissionService.capacityDetail(report)).toMatchObject({
      hostNeededBytes: 30 * GIB,
      hostHeldBytes: 2 * GIB,
      hostAvailableBytes: 12 * GIB,
    });
  });
});
