import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GpuVendor, InstanceState, ProcessAttribution, TelemetryState } from '@libs/agent-protocol';
import { GIB, IInstancePins } from '@libs/backends';

import { Gpu } from '@/core/gpu/entities/gpu.entity';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { FitRefusal, IAdmittedUsage, VramLedgerService } from '@/core/ledger/vram-ledger.service';
import { NodeStateService } from '@/core/node/node-state.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { TEST_DEPLOYMENT_ID } from '@/test/deployment.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const CARD_A = 'GPU-aaaaaaaa-0000-0000-0000-000000000000';
const CARD_B = 'GPU-bbbbbbbb-0000-0000-0000-000000000000';

const KEY_1 = '01999999-0000-7000-8000-000000000001';
const KEY_2 = '01999999-0000-7000-8000-000000000002';

const ON_A: IInstancePins = { cpu: false, gpus: [CARD_A] };
const ON_BOTH: IInstancePins = { cpu: false, gpus: [CARD_A, CARD_B] };

interface IProcessReading {
  instanceKey: string | null;
  usedBytes: number | null;
}

interface ICardReading {
  deviceKey: string;
  usedBytes: number | null;
  attribution?: ProcessAttribution;
  processes?: IProcessReading[];
}

describe('VramLedgerService', () => {
  let gpus: Gpu[];
  let deploymentRemoved: Subject<number>;
  let agentConnectionService: { gpuHeadroomFor: ReturnType<typeof vi.fn> };
  let nodeStateService: NodeStateService;
  let telemetryService: TelemetryService;
  let ledger: VramLedgerService;

  beforeEach(() => {
    gpus = [gpu(CARD_A, 24 * GIB), gpu(CARD_B, 24 * GIB)];
    deploymentRemoved = new Subject<number>();
    agentConnectionService = { gpuHeadroomFor: vi.fn().mockReturnValue(null) };
    nodeStateService = new NodeStateService();
    telemetryService = new TelemetryService();

    ledger = new VramLedgerService(
      agentConnectionService as unknown as AgentConnectionService,
      { deploymentRemoved: () => deploymentRemoved.asObservable() } as unknown as DeploymentService,
      { findByNodeId: vi.fn(() => Promise.resolve(gpus)) } as unknown as GpuService,
      nodeStateService,
      telemetryService
    );

    ledger.onModuleInit();
  });

  afterEach(() => {
    ledger.onModuleDestroy();
  });

  const gpu = (deviceKey: string, memoryTotalBytes: number | null): Gpu =>
    new Gpu({
      nodeId: TEST_NODE_ID,
      deviceKey,
      vendor: GpuVendor.NVIDIA,
      name: 'RTX 4090',
      pciBusId: null,
      memoryTotalBytes,
      index: null,
      lastReportedDate: new Date(),
    });

  const report = (cards: ICardReading[], hostFreeBytes = 0): void => {
    telemetryService.recordTelemetry(TEST_NODE_ID, {
      capturedAt: new Date().toISOString(),
      telemetryState: TelemetryState.OK,
      devices: cards.map((card, index) => ({
        deviceKey: card.deviceKey,
        index,
        memoryUsedBytes: card.usedBytes,
        utilisationPercent: null,
        temperatureC: null,
        powerDrawWatts: null,
        processAttribution: card.attribution ?? ProcessAttribution.EXACT,
        processes: (card.processes ?? []).map((process, pid) => ({
          pid,
          usedBytes: process.usedBytes,
          name: null,
          containerId: null,
          containerName: null,
          instanceKey: process.instanceKey,
        })),
      })),
      host: {
        cpuModel: null,
        cpuCount: 16,
        loadAverage1m: null,
        memoryTotalBytes: 64 * GIB,
        memoryFreeBytes: hostFreeBytes,
      },
      errors: [],
    });
  };

  const usage = (expectedBytes: number, hostBytes: number, cardShares: number[] | null = null): IAdmittedUsage => ({
    expectedBytes,
    hostBytes,
    cardShares,
  });

  const observe = (instances: { instanceKey: string; instanceState: InstanceState }[]): void => {
    nodeStateService.replaceObserved(TEST_NODE_ID, {
      desiredGeneration: 1,
      instances: instances.map(instance => ({
        ...instance,
        revision: 1,
        message: null,
        uptimeMs: 0,
        exitCode: null,
      })),
    });
  };

  describe('figures', () => {
    it("reads a card's free memory as its total, less what is measured, less what is predicted", async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(6 * GIB, 0));

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.cards).toEqual([
        {
          deviceKey: CARD_A,
          totalBytes: 24 * GIB,
          usedBytes: 4 * GIB,
          predictedBytes: 6 * GIB,
          headroomBytes: GIB,
          freeBytes: 14 * GIB,
          neededBytes: null,
        },
      ]);
    });

    it('answers for a card nothing has been placed on, and holds nothing for asking', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      await ledger.check(TEST_NODE_ID, ON_A, usage(10 * GIB, 0));
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(10 * GIB, 0));

      expect(fit.cards[0].predictedBytes).toBe(0);
      expect(fit.refusal).toBeNull();
    });

    it('counts memory held by software it did not start, since measurement is card-level', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 20 * GIB }]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(4 * GIB, 0));

      expect(fit.refusal).toBe(FitRefusal.TOO_LARGE);
    });
  });

  describe('figures a screen reads', () => {
    it('answers what is predicted on a card per instance, and nothing on one nothing is placed on', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(6 * GIB, 0));

      expect(ledger.predictionsOn(TEST_NODE_ID, CARD_A)).toEqual([{ instanceKey: KEY_1, bytes: 6 * GIB }]);
      expect(ledger.predictionsOn(TEST_NODE_ID, CARD_B)).toEqual([]);
    });

    it('reads headroom as the agent reported it, and as 1 GiB where it reported none', () => {
      expect(ledger.headroomFor(TEST_NODE_ID)).toBe(GIB);

      agentConnectionService.gpuHeadroomFor.mockReturnValue(2 * GIB);

      expect(ledger.headroomFor(TEST_NODE_ID)).toBe(2 * GIB);
    });
  });

  describe('GPU only', () => {
    it('admits what fits in the pooled free memory of the pinned cards, less headroom on each', async () => {
      report([
        { deviceKey: CARD_A, usedBytes: 4 * GIB },
        { deviceKey: CARD_B, usedBytes: 4 * GIB },
      ]);

      const exact = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(38 * GIB, 0));
      const over = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(38 * GIB + 1, 0));

      expect(exact).toMatchObject({ refusal: null, availableBytes: 38 * GIB });
      expect(over.refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it("takes the headroom the node's agent reported", async () => {
      agentConnectionService.gpuHeadroomFor.mockReturnValue(4 * GIB);
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(21 * GIB, 0));

      expect(fit).toMatchObject({ refusal: FitRefusal.TOO_LARGE, availableBytes: 20 * GIB });
    });

    it('takes no system memory into the pool', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 32 * GIB);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(30 * GIB, 0));

      expect(fit).toMatchObject({ refusal: FitRefusal.TOO_LARGE, hostFreeBytes: null });
    });

    it('adds nothing to the pool for a card with less free than its headroom', async () => {
      report([
        { deviceKey: CARD_A, usedBytes: 23.5 * GIB },
        { deviceKey: CARD_B, usedBytes: 14 * GIB },
      ]);

      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(GIB, 0));

      expect(fit.availableBytes).toBe(9 * GIB);
    });

    it("splits its prediction across its cards in proportion to each card's free memory", async () => {
      report([
        { deviceKey: CARD_A, usedBytes: 14 * GIB },
        { deviceKey: CARD_B, usedBytes: 0 },
      ]);

      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(17 * GIB, 0));
      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(GIB, 0));

      expect(fit.cards.map(card => card.predictedBytes)).toEqual([5 * GIB, 12 * GIB]);
    });
  });

  describe('CPU offload', () => {
    const OFFLOADED: IInstancePins = { cpu: true, gpus: [CARD_A] };

    it("admits what fits in the pinned cards less headroom, plus the node's free system memory", async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }], 16 * GIB);

      const exact = await ledger.check(TEST_NODE_ID, OFFLOADED, usage(35 * GIB, 0));
      const over = await ledger.check(TEST_NODE_ID, OFFLOADED, usage(35 * GIB + 1, 0));

      expect(exact).toMatchObject({ refusal: null, hostFreeBytes: 16 * GIB, availableBytes: 35 * GIB });
      expect(over.refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('takes each of its cards whole, however little it is expected to use', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }], 16 * GIB);

      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, OFFLOADED, usage(GIB, 0));
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.cards[0]).toMatchObject({ predictedBytes: 20 * GIB, freeBytes: 0 });
      expect(fit.refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('keeps its cards whole as it loads, holding what it has still to take beside what it has taken', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }], 16 * GIB);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, OFFLOADED, usage(GIB, 0));

      report([{ deviceKey: CARD_A, usedBytes: 9 * GIB, processes: [{ instanceKey: KEY_1, usedBytes: 5 * GIB }] }]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.cards[0]).toMatchObject({ predictedBytes: 15 * GIB, freeBytes: 0 });
      expect(fit.refusal).toBe(FitRefusal.TOO_LARGE);
    });
  });

  describe('weights kept in system memory', () => {
    const OFFLOADED: IInstancePins = { cpu: true, gpus: [CARD_A] };

    it('admits a GPU-only start whose host weights fit in free system memory, and refuses one they do not', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 16 * GIB);

      const exact = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 16 * GIB));
      const over = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 16 * GIB + 1));

      expect(exact.refusal).toBeNull();
      expect(over).toMatchObject({
        refusal: FitRefusal.HOST_MEMORY,
        hostWeights: { neededBytes: 16 * GIB + 1, predictedBytes: 0, freeBytes: 16 * GIB },
      });
    });

    it('keeps system memory out of a GPU-only pool, checking the host weights against it apart', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 16 * GIB);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(23 * GIB, 16 * GIB));

      expect(fit).toMatchObject({ refusal: null, hostFreeBytes: null, availableBytes: 23 * GIB });
    });

    it('reports no host figures where nothing is kept in system memory', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 0);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit).toMatchObject({ refusal: null, hostWeights: null });
    });

    it('counts host weights once in an offloading pool, taking them from its system memory', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }], 16 * GIB);

      const exact = await ledger.check(TEST_NODE_ID, OFFLOADED, usage(30 * GIB, 5 * GIB));
      const over = await ledger.check(TEST_NODE_ID, OFFLOADED, usage(30 * GIB, 5 * GIB + 1));

      expect(exact).toMatchObject({ refusal: null, hostFreeBytes: 16 * GIB, availableBytes: 35 * GIB });
      expect(over.refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('refuses an offloading start whose host weights outgrow the system memory, however much the cards have', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 4 * GIB }], 4 * GIB);

      const fit = await ledger.check(TEST_NODE_ID, OFFLOADED, usage(GIB, 5 * GIB));

      expect(fit.refusal).toBe(FitRefusal.HOST_MEMORY);
    });

    it("holds a loading start's host weights, so a second start cannot count the same free memory", async () => {
      report(
        [
          { deviceKey: CARD_A, usedBytes: 0 },
          { deviceKey: CARD_B, usedBytes: 0 },
        ],
        16 * GIB
      );
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      const fit = await ledger.check(TEST_NODE_ID, { cpu: false, gpus: [CARD_B] }, usage(GIB, 7 * GIB));

      expect(fit).toMatchObject({
        refusal: FitRefusal.HOST_MEMORY,
        hostWeights: { neededBytes: 7 * GIB, predictedBytes: 10 * GIB, freeBytes: 6 * GIB },
      });
    });

    it("takes a loading start's host weights out of an offloading pool's system memory", async () => {
      report(
        [
          { deviceKey: CARD_A, usedBytes: 0 },
          { deviceKey: CARD_B, usedBytes: 0 },
        ],
        16 * GIB
      );
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      const fit = await ledger.check(TEST_NODE_ID, { cpu: true, gpus: [CARD_B] }, usage(GIB, 0));

      expect(fit.hostFreeBytes).toBe(6 * GIB);
    });

    it('lets go of the host weights once the instance is measured', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 16 * GIB);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      observe([{ instanceKey: KEY_1, instanceState: InstanceState.READY }]);
      report([{ deviceKey: CARD_A, usedBytes: GIB }], 6 * GIB);
      report([{ deviceKey: CARD_A, usedBytes: GIB }], 6 * GIB);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 6 * GIB));

      expect(fit).toMatchObject({ refusal: null, hostWeights: { predictedBytes: 0, freeBytes: 6 * GIB } });
    });

    it('holds no host weights for a start it refused', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 4 * GIB);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 4 * GIB));

      expect(fit).toMatchObject({ refusal: null, hostWeights: { predictedBytes: 0 } });
    });

    it('reads no system memory as free where loading instances hold more than the reading shows', async () => {
      report(
        [
          { deviceKey: CARD_A, usedBytes: 0 },
          { deviceKey: CARD_B, usedBytes: 0 },
        ],
        16 * GIB
      );
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      report(
        [
          { deviceKey: CARD_A, usedBytes: 0 },
          { deviceKey: CARD_B, usedBytes: 0 },
        ],
        4 * GIB
      );

      const fit = await ledger.check(TEST_NODE_ID, { cpu: false, gpus: [CARD_B] }, usage(GIB, 1));

      expect(fit.hostWeights).toMatchObject({ predictedBytes: 10 * GIB, freeBytes: 0 });
    });

    it('lets go of the host weights of an admission whose row was never written', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 16 * GIB);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      ledger.release(KEY_1);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 16 * GIB));

      expect(fit).toMatchObject({ refusal: null, hostWeights: { predictedBytes: 0 } });
    });

    it('checks and holds nothing for a start on the CPU alone', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }], 4 * GIB);

      const admitted = await ledger.admit(
        KEY_1,
        TEST_DEPLOYMENT_ID,
        TEST_NODE_ID,
        { cpu: true, gpus: [] },
        usage(0, 10 * GIB)
      );
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 4 * GIB));

      expect(admitted).toMatchObject({ refusal: null, hostWeights: null });
      expect(fit).toMatchObject({ refusal: null, hostWeights: { predictedBytes: 0 } });
    });

    it('reports no host figures beside a card that has not reported', async () => {
      report([{ deviceKey: CARD_A, usedBytes: null }], 4 * GIB);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      expect(fit).toMatchObject({ refusal: FitRefusal.UNMEASURED_CARD, hostWeights: null });
    });

    it('changes nothing on a node that has not reported, which is refused as before', async () => {
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 10 * GIB));

      expect(fit).toMatchObject({ refusal: FitRefusal.NO_TELEMETRY, hostWeights: null });
    });
  });

  describe('CPU only', () => {
    it('admits against nothing, before the node has reported and holding no card', async () => {
      const admitted = await ledger.admit(
        KEY_1,
        TEST_DEPLOYMENT_ID,
        TEST_NODE_ID,
        { cpu: true, gpus: [] },
        usage(64 * GIB, 0)
      );

      report([{ deviceKey: CARD_A, usedBytes: 0 }]);
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(admitted.refusal).toBeNull();
      expect(fit.cards[0].predictedBytes).toBe(0);
    });
  });

  describe('what cannot admit', () => {
    it('admits nothing on a node that has not reported since the server started', async () => {
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.refusal).toBe(FitRefusal.NO_TELEMETRY);
    });

    it('admits nothing on a node whose readings were dropped with its session', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);
      telemetryService.forget(TEST_NODE_ID);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.refusal).toBe(FitRefusal.NO_TELEMETRY);
    });

    it('has no free figure for a card whose used memory is unknown', async () => {
      report([{ deviceKey: CARD_A, usedBytes: null }]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.cards[0].freeBytes).toBeNull();
      expect(fit.refusal).toBe(FitRefusal.UNMEASURED_CARD);
    });

    it('has no free figure for a card whose total is unknown', async () => {
      gpus = [gpu(CARD_A, null)];
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.refusal).toBe(FitRefusal.UNMEASURED_CARD);
    });

    it('holds no prediction for a start it refused', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(30 * GIB, 0));
      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

      expect(fit.cards[0].predictedBytes).toBe(0);
    });
  });

  describe('serialised admission', () => {
    it('lets only one of two starts decided in the same instant take the same free space', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      const outcomes = await Promise.all([
        ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(15 * GIB, 0)),
        ledger.admit(KEY_2, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(15 * GIB, 0)),
      ]);

      expect(outcomes.map(outcome => outcome.refusal)).toEqual([null, FitRefusal.TOO_LARGE]);
    });

    it('admits both where both fit', async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      const outcomes = await Promise.all([
        ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(10 * GIB, 0)),
        ledger.admit(KEY_2, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(10 * GIB, 0)),
      ]);

      expect(outcomes.map(outcome => outcome.refusal)).toEqual([null, null]);
    });
  });

  it("counts no other node's predictions against a card", async () => {
    report([{ deviceKey: CARD_A, usedBytes: 0 }]);
    await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID + 1, ON_A, usage(10 * GIB, 0));

    const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(GIB, 0));

    expect(fit.cards[0].predictedBytes).toBe(0);
  });

  describe('a load counted once', () => {
    const PREDICTED = 15 * GIB;
    const DRIVER = GIB / 2;

    beforeEach(async () => {
      report([{ deviceKey: CARD_A, usedBytes: DRIVER }]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(PREDICTED, 0));
    });

    const loaded = (bytes: number, card: Partial<ICardReading> = {}): void =>
      report([
        {
          deviceKey: CARD_A,
          usedBytes: DRIVER + bytes,
          processes: bytes > 0 ? [{ instanceKey: KEY_1, usedBytes: bytes }] : [],
          ...card,
        },
      ]);

    const card = async (): Promise<{ usedBytes: number; predictedBytes: number }> => {
      const figures = (await ledger.check(TEST_NODE_ID, ON_A, usage(0, 0))).cards[0];

      return { usedBytes: figures.usedBytes ?? 0, predictedBytes: figures.predictedBytes };
    };

    it('holds the whole prediction at the start of a load, before the reading attributes anything to it', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      loaded(0);

      expect((await card()).predictedBytes).toBe(PREDICTED);
      expect((await ledger.check(TEST_NODE_ID, ON_A, usage(8 * GIB, 0))).refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('holds only what the load has still to take mid-load, so a start that fits beside it is admitted', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      loaded(7 * GIB);

      expect(await card()).toEqual({ usedBytes: DRIVER + 7 * GIB, predictedBytes: 8 * GIB });

      const admitted = await ledger.admit(KEY_2, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(7 * GIB, 0));

      expect(admitted.refusal).toBeNull();
    });

    it('refuses a start mid-load that would take memory the load has still to take', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      loaded(7 * GIB);

      expect((await ledger.check(TEST_NODE_ID, ON_A, usage(8 * GIB, 0))).refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('holds what the load fell short of its prediction at ready, until measurement can see it', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.READY }]);
      loaded(13 * GIB);

      expect((await card()).predictedBytes).toBe(2 * GIB);

      loaded(13 * GIB);

      expect((await card()).predictedBytes).toBe(0);
    });

    it('holds nothing once the load has taken its whole prediction or more', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      loaded(17 * GIB);

      expect(await card()).toEqual({ usedBytes: DRIVER + 17 * GIB, predictedBytes: 0 });
      expect(ledger.predictionsOn(TEST_NODE_ID, CARD_A)).toEqual([]);
    });

    it('never reserves less than the load will take, at any point from start to ready', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);

      for (const bytes of [0, GIB, 7 * GIB, 14 * GIB, PREDICTED, 16 * GIB]) {
        loaded(bytes);

        const { usedBytes, predictedBytes } = await card();

        expect(usedBytes + predictedBytes).toBeGreaterThanOrEqual(DRIVER + Math.max(PREDICTED, bytes));
      }

      observe([{ instanceKey: KEY_1, instanceState: InstanceState.READY }]);
      loaded(14 * GIB);

      const { usedBytes, predictedBytes } = await card();

      expect(usedBytes + predictedBytes).toBeGreaterThanOrEqual(DRIVER + PREDICTED);
    });

    it('holds the whole prediction on a card that cannot attribute memory to a process', async () => {
      loaded(7 * GIB, { attribution: ProcessAttribution.UNAVAILABLE });

      expect((await card()).predictedBytes).toBe(PREDICTED);
    });

    it('subtracts on an approximate card where only another process went unreported', async () => {
      loaded(0, {
        usedBytes: DRIVER + 9 * GIB,
        attribution: ProcessAttribution.APPROXIMATE,
        processes: [
          { instanceKey: KEY_1, usedBytes: 7 * GIB },
          { instanceKey: null, usedBytes: null },
        ],
      });

      expect((await card()).predictedBytes).toBe(8 * GIB);
    });

    it('holds the whole prediction where one of its own processes went unreported', async () => {
      loaded(0, {
        usedBytes: DRIVER + 9 * GIB,
        attribution: ProcessAttribution.APPROXIMATE,
        processes: [
          { instanceKey: KEY_1, usedBytes: 7 * GIB },
          { instanceKey: KEY_1, usedBytes: null },
        ],
      });

      expect((await card()).predictedBytes).toBe(PREDICTED);
    });

    it('holds the whole prediction where the card has no used figure to count what is attributed', () => {
      loaded(7 * GIB, { usedBytes: null });

      expect(ledger.predictionsOn(TEST_NODE_ID, CARD_A)).toEqual([{ instanceKey: KEY_1, bytes: PREDICTED }]);
    });

    it("subtracts only the instance's own processes, each of them", async () => {
      loaded(0, {
        usedBytes: DRIVER + 10 * GIB,
        processes: [
          { instanceKey: KEY_1, usedBytes: 3 * GIB },
          { instanceKey: KEY_1, usedBytes: 2 * GIB },
          { instanceKey: KEY_2, usedBytes: 4 * GIB },
          { instanceKey: null, usedBytes: GIB },
        ],
      });

      expect((await card()).predictedBytes).toBe(10 * GIB);
    });

    it('holds more again as a stopping load frees what it had taken', async () => {
      ledger.markStopping([KEY_1]);
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      loaded(7 * GIB);

      expect((await card()).predictedBytes).toBe(8 * GIB);

      loaded(0);

      expect((await card()).predictedBytes).toBe(PREDICTED);
    });

    it('subtracts no more than the card reads as used, since its processes are read a moment after', async () => {
      loaded(7 * GIB, { usedBytes: 5 * GIB });

      expect((await card()).predictedBytes).toBe(10 * GIB);
    });
  });

  describe('a placed split', () => {
    beforeEach(() => {
      report([
        { deviceKey: CARD_A, usedBytes: 4 * GIB },
        { deviceKey: CARD_B, usedBytes: 0 },
      ]);
    });

    it('holds each card its share of the placement, scaled to the expected bytes', async () => {
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0, [3, 1]));
      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(GIB, 0));

      expect(fit.cards.map(card => card.predictedBytes)).toEqual([15 * GIB, 5 * GIB]);
    });

    it('ignores shares that do not name every card, splitting by free memory instead', async () => {
      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0, [20 * GIB]));

      expect(fit.cards.map(card => card.neededBytes)).toEqual([null, null]);
    });

    it('refuses a card short of its share though the pooled cards have room, naming it', async () => {
      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0, [1, 0]));

      expect(fit).toMatchObject({
        refusal: FitRefusal.CARD_TOO_SMALL,
        shortCard: CARD_A,
        availableBytes: 42 * GIB,
      });
      expect(fit.cards[0].neededBytes).toBe(20 * GIB);
    });

    it('refuses a card whose whole memory is short of its share, naming it, before what is free', async () => {
      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(30 * GIB, 0, [1, 0]));

      expect(fit).toMatchObject({ refusal: FitRefusal.CARD_OUTGROWN, shortCard: CARD_A });
    });

    it('passes over a card with no total rather than refusing it as outgrown', async () => {
      gpus = [gpu(CARD_A, null), gpu(CARD_B, 24 * GIB)];

      const fit = await ledger.check(TEST_NODE_ID, ON_BOTH, usage(30 * GIB, 0, [1, 0]));

      expect(fit.refusal).not.toBe(FitRefusal.CARD_OUTGROWN);
    });

    it('holds nothing for a start refused on one card', async () => {
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0, [1, 0]));

      expect(ledger.predictionsOn(TEST_NODE_ID, CARD_A)).toEqual([]);
    });

    it('splits by free memory and checks only the pool where the backend balances the cards itself', async () => {
      const fit = await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(30 * GIB, 0));

      expect(fit.refusal).toBeNull();
      expect(fit.cards.map(card => card.neededBytes)).toEqual([null, null]);
      expect(fit.cards.map(card => card.predictedBytes)).toEqual([0, 0]);
    });

    it('takes the cards of an offloading start whole, whatever its shares', async () => {
      const offloaded = { cpu: true, gpus: [CARD_A, CARD_B] };
      const fit = await ledger.check(TEST_NODE_ID, offloaded, usage(2 * GIB, 0, [1, 0]));

      expect(fit.cards.map(card => card.neededBytes)).toEqual([null, null]);
    });
  });

  describe('a load across cards whose split is placed', () => {
    const held = (deviceKey: string): number =>
      ledger.predictionsOn(TEST_NODE_ID, deviceKey).reduce((sum, prediction) => sum + prediction.bytes, 0);

    beforeEach(async () => {
      report([
        { deviceKey: CARD_A, usedBytes: 0 },
        { deviceKey: CARD_B, usedBytes: 0 },
      ]);

      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0, [16, 4]));
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      report([
        { deviceKey: CARD_A, usedBytes: 8 * GIB, processes: [{ instanceKey: KEY_1, usedBytes: 8 * GIB }] },
        { deviceKey: CARD_B, usedBytes: 2 * GIB, processes: [{ instanceKey: KEY_1, usedBytes: 2 * GIB }] },
      ]);
    });

    it('holds on the heavier card all it has still to take, before it passes any guess', () => {
      expect([held(CARD_A), held(CARD_B)]).toEqual([8 * GIB, 2 * GIB]);
    });

    it('refuses a start mid-load that would take what the heavier card has still to load', async () => {
      const fits = await ledger.check(TEST_NODE_ID, ON_A, usage(7 * GIB, 0));
      const over = await ledger.check(TEST_NODE_ID, ON_A, usage(7 * GIB + 1, 0));

      expect(fits.refusal).toBeNull();
      expect(over.refusal).toBe(FitRefusal.TOO_LARGE);
    });
  });

  describe('a load across cards', () => {
    const FINAL_A = 16 * GIB;
    const FINAL_B = 4 * GIB;

    beforeEach(async () => {
      report([
        { deviceKey: CARD_A, usedBytes: 0 },
        { deviceKey: CARD_B, usedBytes: 0 },
      ]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_BOTH, usage(20 * GIB, 0));
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
    });

    const loaded = (onA: number, onB: number): void =>
      report([
        { deviceKey: CARD_A, usedBytes: onA, processes: [{ instanceKey: KEY_1, usedBytes: onA }] },
        { deviceKey: CARD_B, usedBytes: onB, processes: [{ instanceKey: KEY_1, usedBytes: onB }] },
      ]);

    const held = (deviceKey: string): number =>
      ledger.predictionsOn(TEST_NODE_ID, deviceKey).reduce((sum, prediction) => sum + prediction.bytes, 0);

    it('holds on each card its own prediction, less what that card has taken', () => {
      loaded(4 * GIB, 0);

      expect([held(CARD_A), held(CARD_B)]).toEqual([6 * GIB, 10 * GIB]);
    });

    it('keeps a card that has outrun its share of the split covered for what the load has still to take', async () => {
      loaded(12 * GIB, 2 * GIB);

      expect([held(CARD_A), held(CARD_B)]).toEqual([6 * GIB, 6 * GIB]);
      expect((await ledger.check(TEST_NODE_ID, ON_A, usage(6 * GIB, 0))).refusal).toBe(FitRefusal.TOO_LARGE);
    });

    it('holds on a card no more than the whole load has still to take, where another has outrun its share', () => {
      loaded(13 * GIB, 5 * GIB);

      expect([held(CARD_A), held(CARD_B)]).toEqual([2 * GIB, 2 * GIB]);
    });

    it('never holds less in all than the load has still to take, however the split turns out', () => {
      for (const progress of [0, 0.25, 0.5, 0.75, 0.9, 1]) {
        const onA = FINAL_A * progress;
        const onB = FINAL_B * progress;

        loaded(onA, onB);

        expect(held(CARD_A) + held(CARD_B)).toBeGreaterThanOrEqual(20 * GIB - onA - onB);
      }
    });
  });

  describe('a load across four cards', () => {
    const CARD_C = 'GPU-cccccccc-0000-0000-0000-000000000000';
    const CARD_D = 'GPU-dddddddd-0000-0000-0000-000000000000';
    const CARDS = [CARD_A, CARD_B, CARD_C, CARD_D];
    const ON_ALL: IInstancePins = { cpu: false, gpus: CARDS };
    const SHARE = 20 * GIB;

    beforeEach(async () => {
      gpus = CARDS.map(deviceKey => gpu(deviceKey, 24 * GIB));
      loaded([0, 0, 0, 0]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_ALL, usage(4 * SHARE, 0));
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
    });

    const loaded = (onEach: number[]): void =>
      report(
        CARDS.map((deviceKey, index) => ({
          deviceKey,
          usedBytes: onEach[index],
          processes: [{ instanceKey: KEY_1, usedBytes: onEach[index] }],
        }))
      );

    const held = (): number[] =>
      CARDS.map(deviceKey =>
        ledger.predictionsOn(TEST_NODE_ID, deviceKey).reduce((sum, prediction) => sum + prediction.bytes, 0)
      );

    const total = (bytes: number[]): number => bytes.reduce((sum, each) => sum + each, 0);

    it.each([0.25, 0.5, 0.75])("frees each card's hold as its own share arrives, %s of the way in", progress => {
      const onEach = CARDS.map(() => SHARE * progress);

      loaded(onEach);

      expect(held()).toEqual(onEach.map(bytes => SHARE - bytes));
      expect(total(held())).toBe(4 * SHARE - total(onEach));
    });

    it('covers a card that has outrun its share for all the load has left, and the rest for their own', () => {
      const onEach = [21 * GIB, 19.5 * GIB, 19.5 * GIB, 19.5 * GIB];

      loaded(onEach);

      expect(held()).toEqual([0.5 * GIB, 0.5 * GIB, 0.5 * GIB, 0.5 * GIB]);
      expect(total(held())).toBeGreaterThanOrEqual(4 * SHARE - total(onEach));
    });

    it('covers a card that has outrun its share only as far as its headroom, since it can take no more', () => {
      const onEach = [22 * GIB, 10 * GIB, 10 * GIB, 6 * GIB];

      loaded(onEach);

      expect(held()).toEqual([GIB, 10 * GIB, 10 * GIB, 14 * GIB]);
      expect(total(held())).toBeGreaterThanOrEqual(4 * SHARE - total(onEach));
    });

    it('holds nothing on a card that has taken exactly its share, and all that is left once it passes it', () => {
      loaded([SHARE, 10 * GIB, 10 * GIB, 10 * GIB]);

      expect(held()[0]).toBe(0);

      loaded([SHARE + 1, 10 * GIB, 10 * GIB, 10 * GIB]);

      expect(held()[0]).toBe(3 * GIB - 1);
    });

    it('admits a start beside the load on what each card has still to take, not the whole remainder', async () => {
      loaded([10 * GIB, 10 * GIB, 10 * GIB, 10 * GIB]);

      const fit = await ledger.check(TEST_NODE_ID, ON_A, usage(3 * GIB, 0));

      expect(fit.cards[0].predictedBytes).toBe(10 * GIB);
      expect(fit.refusal).toBeNull();
    });
  });

  describe('a prediction over time', () => {
    beforeEach(async () => {
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);
      await ledger.admit(KEY_1, TEST_DEPLOYMENT_ID, TEST_NODE_ID, ON_A, usage(10 * GIB, 0));
    });

    const predicted = async (): Promise<number> =>
      (await ledger.check(TEST_NODE_ID, ON_A, usage(0, 0))).cards[0].predictedBytes;

    it('holds while the instance is starting', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);
      report([{ deviceKey: CARD_A, usedBytes: 6 * GIB }]);

      expect(await predicted()).toBe(10 * GIB);
    });

    it('gives way to measurement on the second reading after the instance reports ready', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.READY }]);
      report([{ deviceKey: CARD_A, usedBytes: 6 * GIB }]);

      expect(await predicted()).toBe(10 * GIB);

      report([{ deviceKey: CARD_A, usedBytes: 11 * GIB }]);

      expect(await predicted()).toBe(0);
    });

    it('counts no dropped session as a reading', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.READY }]);
      telemetryService.forget(TEST_NODE_ID);
      report([{ deviceKey: CARD_A, usedBytes: 6 * GIB }]);

      expect(await predicted()).toBe(10 * GIB);
    });

    it('gives way the same for a launch that failed, whose container holds only what measurement sees', async () => {
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.FAILED }]);
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);
      report([{ deviceKey: CARD_A, usedBytes: 0 }]);

      expect(await predicted()).toBe(0);
    });

    it("leaves another node's report to that node's instances", async () => {
      nodeStateService.replaceObserved(TEST_NODE_ID + 1, { desiredGeneration: 1, instances: [] });
      ledger.markStopping([KEY_1]);
      nodeStateService.replaceObserved(TEST_NODE_ID + 1, { desiredGeneration: 1, instances: [] });

      expect(await predicted()).toBe(10 * GIB);
    });

    it("keeps a stopped instance's memory counted until the node stops reporting its container", async () => {
      ledger.markStopping([KEY_1]);
      observe([{ instanceKey: KEY_1, instanceState: InstanceState.STARTING }]);

      expect(await predicted()).toBe(10 * GIB);

      observe([]);

      expect(await predicted()).toBe(0);
    });

    it('keeps an instance the node has not yet reported, since its container may not exist yet', async () => {
      observe([]);

      expect(await predicted()).toBe(10 * GIB);
    });

    it("stops counting a deleted deployment's instances once their containers go", async () => {
      deploymentRemoved.next(TEST_DEPLOYMENT_ID);
      observe([]);

      expect(await predicted()).toBe(0);
    });

    it('lets go of an admission whose row was never written', async () => {
      ledger.release(KEY_1);

      expect(await predicted()).toBe(0);
    });
  });
});
