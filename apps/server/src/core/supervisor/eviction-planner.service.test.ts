import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { GIB, IInstancePins, LaunchMode } from '@libs/backends';
import { ActivationPolicy } from '@libs/dto';

import { Instance } from '@/core/instance/entities/instance.entity';

import { ConfigService } from '@/config/config.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { INodePlacement } from '@/core/instance/instance-launch.service';
import { InstanceService } from '@/core/instance/instance.service';
import { FitRefusal, IFitReport, VramLedgerService } from '@/core/ledger/vram-ledger.service';
import { EvictionPlannerService, IEvictionFacts } from '@/core/supervisor/eviction-planner.service';
import { InstanceLeaseService } from '@/core/supervisor/instance-lease.service';
import { SupervisorPolicyService } from '@/core/supervisor/supervisor-policy.service';

import { buildDeployment } from '@/test/deployment.factory';
import { buildInstance } from '@/test/instance.factory';

const NOW = new Date('2026-10-20T12:00:00Z');
const NODE_ID = 3;
const CARD = 'GPU-card-a';
const OTHER_CARD = 'GPU-card-b';
const PINS: IInstancePins = { cpu: false, gpus: [CARD] };
const MIN_RESIDENCY_MS = 120_000;

const minutesBefore = (minutes: number): Date => new Date(NOW.getTime() - minutes * 60_000);

const refusal = (overrides: Partial<IFitReport> = {}): IFitReport => ({
  launchMode: LaunchMode.GPU_ONLY,
  expectedBytes: 20 * GIB,
  cards: [],
  hostFreeBytes: null,
  availableBytes: 5 * GIB,
  hostWeights: null,
  shortCard: null,
  refusal: FitRefusal.TOO_LARGE,
  ...overrides,
});

const facts = (id: number, overrides: Partial<IEvictionFacts> = {}): IEvictionFacts => ({
  instance: buildInstance({
    id,
    instanceKey: `key-${id}`,
    deploymentId: id,
    nodeId: NODE_ID,
    pins: PINS,
    instanceState: InstanceState.READY,
  }),
  activationPolicy: ActivationPolicy.ON_DEMAND,
  ready: true,
  draining: false,
  inFlight: 0,
  waiting: 0,
  readyDate: minutesBefore(10),
  idleSince: minutesBefore(5),
  ...overrides,
});

describe('EvictionPlannerService', () => {
  let planner: EvictionPlannerService;
  let instanceService: { findAll: ReturnType<typeof vi.fn> };
  let admission: { checkReleasing: ReturnType<typeof vi.fn> };
  let lease: { isDraining: ReturnType<typeof vi.fn>; inFlightOn: ReturnType<typeof vi.fn> };
  let ledger: { attributedBytes: ReturnType<typeof vi.fn> };

  const requester = buildDeployment({ id: 1 });

  const placement = (report: IFitReport = refusal()): INodePlacement => ({
    nodeId: NODE_ID,
    pins: PINS,
    problem: 'full',
    capacity: report,
  });

  const candidateRow = (id: number, overrides: Partial<Instance> = {}): Instance =>
    buildInstance({
      id,
      instanceKey: `key-${id}`,
      deploymentId: id + 100,
      nodeId: NODE_ID,
      pins: PINS,
      instanceState: InstanceState.READY,
      readyDate: minutesBefore(10),
      deployment: buildDeployment({
        id: id + 100,
        name: `deployment-${id}`,
        activationPolicy: ActivationPolicy.ON_DEMAND,
        lastUsedDate: minutesBefore(id),
      }),
      ...overrides,
    });

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });

    instanceService = { findAll: vi.fn().mockResolvedValue([]) };
    admission = { checkReleasing: vi.fn().mockResolvedValue(refusal({ refusal: null })) };
    lease = { isDraining: vi.fn().mockReturnValue(false), inFlightOn: vi.fn().mockReturnValue(0) };
    ledger = { attributedBytes: vi.fn().mockReturnValue(4 * GIB) };

    planner = new EvictionPlannerService(
      { schedulerMinResidencyMs: MIN_RESIDENCY_MS } as unknown as ConfigService,
      admission as unknown as InstanceAdmissionService,
      lease as unknown as InstanceLeaseService,
      instanceService as unknown as InstanceService,
      new SupervisorPolicyService(),
      ledger as unknown as VramLedgerService
    );
  });

  describe('candidatesFrom', () => {
    const run = (candidates: IEvictionFacts[], fit: FitRefusal = FitRefusal.TOO_LARGE) =>
      planner.candidatesFrom(candidates, fit, PINS, MIN_RESIDENCY_MS, NOW).map(candidate => candidate.instance.id);

    it('orders by least recently used', () => {
      expect(run([facts(1, { idleSince: minutesBefore(1) }), facts(2, { idleSince: minutesBefore(30) })])).toEqual([
        2, 1,
      ]);
    });

    it('considers only onDemand instances, never an always one', () => {
      expect(run([facts(1, { activationPolicy: ActivationPolicy.ALWAYS }), facts(2)])).toEqual([2]);
    });

    it('holds back an instance not resident for the minimum', () => {
      expect(run([facts(1, { readyDate: minutesBefore(1) }), facts(2)])).toEqual([2]);
    });

    it('passes over anything not ready, draining, busy or with a request waiting', () => {
      expect(
        run([
          facts(1, { ready: false }),
          facts(2, { draining: true }),
          facts(3, { inFlight: 1 }),
          facts(4, { waiting: 1 }),
          facts(5, { readyDate: null }),
          facts(6),
        ])
      ).toEqual([6]);
    });

    it('takes a VRAM candidate only where its pins overlap the refused pins', () => {
      const elsewhere = facts(1);

      elsewhere.instance.pins = { cpu: false, gpus: [OTHER_CARD] };

      expect(run([elsewhere, facts(2)])).toEqual([2]);
    });

    it('takes any instance on the node for a host memory refusal', () => {
      const elsewhere = facts(1);

      elsewhere.instance.pins = { cpu: false, gpus: [OTHER_CARD] };

      expect(run([elsewhere, facts(2)], FitRefusal.HOST_MEMORY)).toEqual([1, 2]);
    });
  });

  describe('plan', () => {
    it('adds victims in order until the placement fits, and stops at the first that does', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1), candidateRow(2), candidateRow(3)]);
      admission.checkReleasing
        .mockResolvedValueOnce(refusal({ availableBytes: 8 * GIB }))
        .mockResolvedValueOnce(refusal({ refusal: null }));

      const plan = await planner.plan(requester, placement(), () => 0);

      expect(plan?.victims.map(victim => victim.instance.id)).toEqual([3, 2]);
      expect(admission.checkReleasing).toHaveBeenCalledTimes(2);
    });

    it('plans nothing for a load in progress, which eviction cannot shorten', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1)]);

      const plan = await planner.plan(requester, placement(refusal({ refusal: FitRefusal.LOAD_IN_PROGRESS })), () => 0);

      expect(plan).toBeNull();
    });

    it('counts a plan that leaves only a load to wait out as fitting', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1)]);
      admission.checkReleasing.mockResolvedValueOnce(refusal({ refusal: FitRefusal.LOAD_IN_PROGRESS }));

      const plan = await planner.plan(requester, placement(), () => 0);

      expect(plan?.victims.map(victim => victim.instance.id)).toEqual([1]);
    });

    it('answers no plan where every victim together still does not fit', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1)]);
      admission.checkReleasing.mockResolvedValue(refusal({ availableBytes: 8 * GIB }));

      await expect(planner.plan(requester, placement(), () => 0)).resolves.toBeNull();
    });

    it('passes over a victim that frees nothing', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(2), candidateRow(1)]);
      admission.checkReleasing
        .mockResolvedValueOnce(refusal({ availableBytes: 5 * GIB }))
        .mockResolvedValueOnce(refusal({ refusal: null }));

      const plan = await planner.plan(requester, placement(), () => 0);

      expect(plan?.victims.map(victim => victim.instance.id)).toEqual([1]);
    });

    it('passes over a victim that frees memory other than what the refusal is short of', async () => {
      const hostWeights = { neededBytes: 8 * GIB, cacheBytes: 0, predictedBytes: 0, freeBytes: 2 * GIB };
      const refused = refusal({ refusal: FitRefusal.HOST_MEMORY, hostWeights });

      instanceService.findAll.mockResolvedValue([candidateRow(2), candidateRow(1)]);
      admission.checkReleasing
        .mockResolvedValueOnce({ ...refused, availableBytes: 9 * GIB })
        .mockResolvedValueOnce(refusal({ refusal: null }));

      const plan = await planner.plan(requester, placement(refused), () => 0);

      expect(plan?.victims.map(victim => victim.instance.id)).toEqual([1]);
    });

    it.each([FitRefusal.NO_TELEMETRY, FitRefusal.UNMEASURED_CARD, FitRefusal.CARD_OUTGROWN])(
      'does not plan for %s',
      async fit => {
        await expect(planner.plan(requester, placement(refusal({ refusal: fit })), () => 0)).resolves.toBeNull();
        expect(instanceService.findAll).not.toHaveBeenCalled();
      }
    );

    it("never takes the requester's own instances", async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1, { deploymentId: requester.id })]);

      await expect(planner.plan(requester, placement(), () => 0)).resolves.toBeNull();
    });

    it('records how long the victim idled and what the ledger attributes to it', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(5)]);

      const plan = await planner.plan(requester, placement(), () => 0);

      expect(plan?.victims[0]).toMatchObject({ idleMs: 5 * 60_000, releasedBytes: 4 * GIB });
    });

    it('passes over an instance whose deployment has a request waiting', async () => {
      instanceService.findAll.mockResolvedValue([candidateRow(1)]);

      await expect(planner.plan(requester, placement(), () => 1)).resolves.toBeNull();
    });
  });
});
