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
  let vramLedgerService: { check: ReturnType<typeof vi.fn>; admit: ReturnType<typeof vi.fn> };
  let instanceAdmissionService: InstanceAdmissionService;

  beforeEach(() => {
    expectedUsageService = {
      expectedFor: vi.fn().mockResolvedValue({
        known: true,
        bytes: 20 * GIB,
        source: ExpectedUsageSource.ESTIMATED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
        cardShares: null,
      }),
    };
    vramLedgerService = {
      check: vi.fn().mockResolvedValue(fitReport()),
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
      { expectedBytes: 20 * GIB, hostBytes: 0, cardShares: null }
    );
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
      "This deployment's memory use cannot be estimated without the model's layerCount, `contextSize`; " +
        'declare its VRAM as `vramGib` to start it'
    );
    expect(vramLedgerService.admit).not.toHaveBeenCalled();
  });

  it('names a pinned card that has not reported its total', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: false,
      missing: [{ source: EstimateInputSource.DEVICE, field: 'GPU-a' }],
    });

    const admission = await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

    expect(admission.problem).toBe(
      "This deployment's memory use cannot be estimated without the total memory of GPU GPU-a, which it has not reported"
    );
  });

  it('names what the deployment needs where the pinned GPUs are too full, carrying the figures', async () => {
    const refused = fitReport({ refusal: FitRefusal.TOO_LARGE });

    vramLedgerService.admit.mockResolvedValue(refused);

    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject({
      problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
      capacity: refused,
    });
  });

  it('names the card short of its share where the pool has room but that card does not', async () => {
    const report = fitReport({ shortCard: 'GPU-a', refusal: FitRefusal.CARD_TOO_SMALL });

    report.cards[0].neededBytes = 15 * GIB;
    vramLedgerService.admit.mockResolvedValue(report);

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('This deployment needs 15.0 GiB on GPU-a, more than it has free');
  });

  it('names a card too small in all, with its total, however much is free on it', async () => {
    const report = fitReport({ shortCard: 'GPU-a', refusal: FitRefusal.CARD_OUTGROWN });

    report.cards[0].totalBytes = 8 * GIB;
    vramLedgerService.admit.mockResolvedValue(report);

    const admission = await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe('This deployment needs more than the 8.0 GiB GPU-a holds in all');
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

    expect(admission.problem).toBe(
      'This deployment needs 20.0 GiB, more than the pinned GPUs and system memory have free'
    );
  });

  it('names the host weights in the pool need of an instance offloading to the CPU', async () => {
    const hostWeights = { neededBytes: 5 * GIB, predictedBytes: 0, freeBytes: 16 * GIB };

    vramLedgerService.admit.mockResolvedValue(
      fitReport({ launchMode: LaunchMode.CPU_OFFLOAD, hostWeights, refusal: FitRefusal.TOO_LARGE })
    );

    const admission = await instanceAdmissionService.admit(buildDeployment(), OFFLOADED, TEST_INSTANCE_KEY);

    expect(admission.problem).toBe(
      'This deployment needs 25.0 GiB, more than the pinned GPUs and system memory have free'
    );
  });

  it('names the weights kept in system memory where the node has too little free', async () => {
    const refused = fitReport({
      hostWeights: { neededBytes: 30 * GIB, predictedBytes: 0, freeBytes: 12 * GIB },
      refusal: FitRefusal.HOST_MEMORY,
    });

    vramLedgerService.admit.mockResolvedValue(refused);

    await expect(instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY)).resolves.toMatchObject({
      problem: 'This deployment keeps 30.0 GiB of weights in system memory, more than the node has free',
      capacity: refused,
    });
  });

  it('checks the host weights the estimate says host memory has to hold', async () => {
    expectedUsageService.expectedFor.mockResolvedValue({
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 35 * GIB,
      hostResidentBytes: 3 * GIB,
      cardShares: null,
    });

    await instanceAdmissionService.preview(buildDeployment(), ON_GPU);
    await instanceAdmissionService.admit(buildDeployment(), ON_GPU, TEST_INSTANCE_KEY);

    const admitted = { expectedBytes: 20 * GIB, hostBytes: 3 * GIB, cardShares: null };

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

    expect(admission.problem).toBe('This node has not reported its GPU memory since it connected');
  });

  it('previews through the ledger check, which holds nothing', async () => {
    vramLedgerService.check.mockResolvedValue(fitReport({ refusal: FitRefusal.UNMEASURED_CARD }));

    const admission = await instanceAdmissionService.preview(buildDeployment(), ON_GPU);

    expect(admission.problem).toBe('A pinned GPU has not reported its total or used memory');
    expect(vramLedgerService.admit).not.toHaveBeenCalled();
  });

  it('previews with the expected figure and its source, whether or not the node has room', async () => {
    const expected = {
      known: true,
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
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

  it('carries the host weights and what is free for them into the event detail', () => {
    const report = fitReport({ hostWeights: { neededBytes: 30 * GIB, predictedBytes: 2 * GIB, freeBytes: 12 * GIB } });

    expect(instanceAdmissionService.capacityDetail(report)).toMatchObject({
      hostNeededBytes: 30 * GIB,
      hostHeldBytes: 2 * GIB,
      hostAvailableBytes: 12 * GIB,
    });
  });
});
