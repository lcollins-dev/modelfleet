import { BadRequestException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { ActivationPolicy, EventType, InstanceChangeReason } from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';
import { Instance } from '@/core/instance/entities/instance.entity';

import { ConfigService } from '@/config/config.service';
import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { DeploymentService, ILaunchFailureCount } from '@/core/deployment/deployment.service';
import { EventService } from '@/core/event/event.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { INodePlacement } from '@/core/instance/instance-launch.service';
import { InstanceService, RoomMaker } from '@/core/instance/instance.service';
import { FitRefusal, IFitReport } from '@/core/ledger/vram-ledger.service';
import { NodeService } from '@/core/node/node.service';
import { DeploymentActionsService } from '@/core/supervisor/deployment-actions.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';
import { EvictionPlannerService, IEvictionPlan } from '@/core/supervisor/eviction-planner.service';
import { InstanceEvictionService } from '@/core/supervisor/instance-eviction.service';
import { InstanceLeaseService } from '@/core/supervisor/instance-lease.service';
import { SupervisorPolicyService } from '@/core/supervisor/supervisor-policy.service';

import { AcquireRefusal, IAcquireOptions } from '@/core/supervisor/supervisor.types';
import { buildDeployment } from '@/test/deployment.factory';
import { buildInstance } from '@/test/instance.factory';

const DEPLOYMENT_ID = 7;

const RELAY = { url: 'http://node', token: 'token' };

const LAUNCH_FAILURE_LIMIT = 3;

const instanceOf = (id: number, instanceState: InstanceState, overrides: Partial<Instance> = {}): Instance =>
  buildInstance({
    id,
    instanceKey: `0199999${id}-3333-7333-8333-333333333333`,
    deploymentId: DEPLOYMENT_ID,
    nodeId: id,
    instanceState,
    createdDate: new Date(),
    ...overrides,
  });

describe('DeploymentSupervisorService', () => {
  let changes: Subject<number[]>;
  let removed: Subject<number>;
  let counted: Subject<ILaunchFailureCount>;
  let rows: Instance[];
  let deployment: Deployment;
  let agentConnectionService: { relayFor: ReturnType<typeof vi.fn> };
  let deploymentService: {
    findWithThrow: Mock<DeploymentService['findWithThrow']>;
    findAll: ReturnType<typeof vi.fn>;
    resolveConfiguration: ReturnType<typeof vi.fn>;
    stampLastUsed: Mock<DeploymentService['stampLastUsed']>;
    deploymentRemoved: () => Subject<number>;
    deploymentChanged: () => Subject<number>;
    launchFailureCounted: () => Subject<ILaunchFailureCount>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let instanceService: {
    instanceChanges: () => Subject<number[]>;
    findForRouting: ReturnType<typeof vi.fn>;
    findByDeploymentId: Mock<InstanceService['findByDeploymentId']>;
    takeDown: Mock<InstanceService['takeDown']>;
    bringUp: ReturnType<typeof vi.fn>;
    isOnOlderSettings: Mock<InstanceService['isOnOlderSettings']>;
    restartProblem: Mock<InstanceService['restartProblem']>;
    clearRestartRequest: Mock<InstanceService['clearRestartRequest']>;
  };
  let deploymentActionsService: DeploymentActionsService;
  let deploymentSupervisorService: DeploymentSupervisorService;
  let planner: { plan: Mock<EvictionPlannerService['plan']> };
  let instanceLeaseService: InstanceLeaseService;

  /** A node's report, which the real observation writes and announces. */
  const report = (next: Instance[]) => {
    rows = next;
    changes.next([DEPLOYMENT_ID]);
  };

  const options = (overrides: Partial<IAcquireOptions> = {}): IAcquireOptions => ({
    signal: new AbortController().signal,
    maxWaitMs: 900_000,
    onWait: vi.fn(),
    ...overrides,
  });

  const acquire = (overrides: Partial<IAcquireOptions> = {}) =>
    deploymentSupervisorService.acquire(DEPLOYMENT_ID, options(overrides));

  /** Resolves once the request is waiting, so what follows happens while it waits. */
  const waiting = async (overrides: Partial<IAcquireOptions> = {}) => {
    const onWait = vi.fn();
    const acquiring = acquire({ ...overrides, onWait });

    await vi.waitFor(() => expect(onWait).toHaveBeenCalled());

    return { acquiring };
  };

  beforeEach(() => {
    changes = new Subject<number[]>();
    removed = new Subject<number>();
    counted = new Subject<ILaunchFailureCount>();
    rows = [];
    deployment = buildDeployment({ id: DEPLOYMENT_ID, activationPolicy: ActivationPolicy.ON_DEMAND });

    agentConnectionService = { relayFor: vi.fn().mockReturnValue(RELAY) };
    deploymentService = {
      // A copy as read, so a change made after the read is not seen through it.
      findWithThrow: vi.fn<DeploymentService['findWithThrow']>(() =>
        Promise.resolve(Object.assign(buildDeployment(), deployment))
      ),
      findAll: vi.fn(() => Promise.resolve([deployment])),
      resolveConfiguration: vi.fn().mockReturnValue({ configuration: {} }),
      stampLastUsed: vi.fn<DeploymentService['stampLastUsed']>().mockResolvedValue(undefined),
      deploymentRemoved: () => removed,
      deploymentChanged: () => new Subject<number>(),
      launchFailureCounted: () => counted,
    };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    instanceService = {
      instanceChanges: () => changes,
      findForRouting: vi.fn(() => Promise.resolve(rows)),
      findByDeploymentId: vi.fn<InstanceService['findByDeploymentId']>(() => Promise.resolve(rows)),
      takeDown: vi.fn<InstanceService['takeDown']>((instances: Instance[]) => {
        rows = rows.filter(row => !instances.includes(row));

        return Promise.resolve();
      }),
      bringUp: vi.fn(() => {
        const started = instanceOf(10 + rows.length, InstanceState.STARTING);

        rows = [...rows, started];

        return Promise.resolve({ started: [started], refused: [] });
      }),
      isOnOlderSettings: vi.fn<InstanceService['isOnOlderSettings']>(
        instance =>
          instance.instanceState !== InstanceState.FAILED &&
          instance.configurationRevision !== deployment.configurationRevision
      ),
      restartProblem: vi.fn<InstanceService['restartProblem']>().mockResolvedValue(null),
      clearRestartRequest: vi.fn<InstanceService['clearRestartRequest']>().mockResolvedValue(undefined),
    };

    deploymentActionsService = new DeploymentActionsService(
      eventService as unknown as EventService,
      { capacityDetail: vi.fn().mockReturnValue({}) } as unknown as InstanceAdmissionService,
      instanceService as unknown as InstanceService,
      { find: vi.fn().mockResolvedValue(null) } as unknown as NodeService
    );

    planner = { plan: vi.fn<EvictionPlannerService['plan']>().mockResolvedValue(null) };
    instanceLeaseService = new InstanceLeaseService(
      agentConnectionService as unknown as AgentConnectionService,
      deploymentService as unknown as DeploymentService
    );

    deploymentSupervisorService = new DeploymentSupervisorService(
      {
        schedulerIdleTimeoutMs: 900_000,
        schedulerLaunchFailureLimit: LAUNCH_FAILURE_LIMIT,
      } as unknown as ConfigService,
      deploymentActionsService,
      deploymentService as unknown as DeploymentService,
      planner as unknown as EvictionPlannerService,
      new InstanceEvictionService(
        eventService as unknown as EventService,
        { capacityDetail: vi.fn().mockReturnValue({}) } as unknown as InstanceAdmissionService,
        instanceLeaseService,
        instanceService as unknown as InstanceService
      ),
      instanceLeaseService,
      instanceService as unknown as InstanceService,
      new SupervisorPolicyService()
    );

    deploymentSupervisorService.onModuleInit();
  });

  afterEach(() => {
    deploymentSupervisorService.onModuleDestroy();
    vi.useRealTimers();
  });

  describe('making room', () => {
    const OTHER_DEPLOYMENT = 99;
    const REFUSED = {
      nodeId: 1,
      pins: { cpu: false, gpus: ['GPU-a'] },
      problem: 'This deployment needs 20 GiB',
      capacity: { refusal: FitRefusal.TOO_LARGE } as IFitReport,
    };

    const victim = (id = 50): Instance =>
      instanceOf(id, InstanceState.READY, { deploymentId: OTHER_DEPLOYMENT, deployment: buildDeployment() });

    const planFor = (instance: Instance): IEvictionPlan => ({
      victims: [{ instance, idleMs: 600_000, releasedBytes: 8 }],
      refused: REFUSED.capacity,
    });

    const refuse = () => instanceService.bringUp.mockResolvedValue({ started: [], refused: [REFUSED] });

    beforeEach(() => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;
    });

    it('claims and stops the victims of a plan that fits, and tells no waiter it does not fit', async () => {
      const instance = victim();

      refuse();
      planner.plan.mockResolvedValue(planFor(instance));

      const { acquiring } = await waiting();
      let settled = false;

      void acquiring.then(() => {
        settled = true;
      });

      await vi.waitFor(() =>
        expect(instanceService.takeDown).toHaveBeenCalledWith(
          [instance],
          expect.objectContaining({ reason: InstanceChangeReason.EVICTED })
        )
      );
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(settled).toBe(false);
      expect(eventService.recordEvent).not.toHaveBeenCalledWith(
        EventType.INSTANCE_START_REFUSED,
        expect.anything(),
        expect.anything()
      );
    });

    it('leaves a refusal standing where no plan fits, stopping nothing', async () => {
      refuse();

      const result = await acquire();

      expect(result.refusal).toBe(AcquireRefusal.DOES_NOT_FIT);
      expect(instanceService.takeDown.mock.calls.every(([instances]) => instances.length === 0)).toBe(true);
    });

    it('chooses no further victims while the mark stands, and keeps the deployment wanted', async () => {
      const instance = victim();

      refuse();
      planner.plan.mockResolvedValueOnce(planFor(instance));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(planner.plan).toHaveBeenCalledTimes(1);
      expect(instanceService.bringUp).toHaveBeenCalledTimes(2);
    });

    it('lifts the mark once a start finds room', async () => {
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      instanceService.bringUp.mockResolvedValue({ started: [instanceOf(9, InstanceState.STARTING)], refused: [] });
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([]);
    });

    describe('a load in progress on the cards', () => {
      const LOADING = { ...REFUSED, capacity: { refusal: FitRefusal.LOAD_IN_PROGRESS } as IFitReport };

      it('marks the node and retries, leaving the planner out of it', async () => {
        instanceService.bringUp.mockResolvedValue({ started: [], refused: [LOADING] });

        await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

        expect(planner.plan).not.toHaveBeenCalled();
        expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([LOADING.nodeId]);
      });
    });

    it('names the nodes the mark is waiting on, for the screen to read', async () => {
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([REFUSED.nodeId]);
    });

    it('lifts the mark when the operator stops the deployment, so nothing starts again', async () => {
      const stop = vi.fn().mockResolvedValue(undefined);

      Object.assign(instanceService, { stop });
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);
      await deploymentSupervisorService.stopByHand(DEPLOYMENT_ID, 1);

      expect(stop).toHaveBeenCalledWith(DEPLOYMENT_ID, 1);
      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([]);
    });

    it('keeps the mark where a claim is lost to a concurrent start of the same deployment', async () => {
      const instance = victim();
      const held = await instanceLeaseService.lease(OTHER_DEPLOYMENT, [instance]);
      let finishPlan: (plan: IEvictionPlan) => void = () => undefined;

      refuse();
      planner.plan.mockReturnValueOnce(
        new Promise(resolve => {
          finishPlan = resolve;
        })
      );

      const reconciling = deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      await vi.waitFor(() => expect(planner.plan).toHaveBeenCalledTimes(1));

      planner.plan.mockResolvedValueOnce(planFor(instance));
      Object.assign(instanceService, {
        start: vi.fn((_id: number, _actor: number, maker: RoomMaker) => maker(deployment, [REFUSED], [])),
      });

      await deploymentSupervisorService.startByHand(DEPLOYMENT_ID, 1, true);

      finishPlan(planFor(instance));
      await reconciling;

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([REFUSED.nodeId]);

      held?.release();
    });

    it('stops waiting on a node once a start there has spent the room made', async () => {
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      instanceService.bringUp.mockResolvedValue({
        started: [instanceOf(9, InstanceState.STARTING, { nodeId: REFUSED.nodeId })],
        refused: [REFUSED],
      });
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([]);
    });

    it('stops waiting on a node refused for something other than capacity', async () => {
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      instanceService.bringUp.mockResolvedValue({
        started: [],
        refused: [{ ...REFUSED, capacity: undefined, problem: 'The node is offline' }],
      });
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([]);
    });

    it('lifts the mark where a start stops being possible at all', async () => {
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      instanceService.bringUp.mockRejectedValue(new BadRequestException('No placement'));
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentSupervisorService.factsFor(deployment, []).makingRoomNodeIds).toEqual([]);
    });

    it('refuses as usual once the mark expires, putting back what was not stopped', async () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T12:00:00Z') });

      const instance = victim();

      refuse();
      planner.plan.mockResolvedValueOnce(planFor(instance));

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      vi.setSystemTime(new Date('2026-10-20T12:06:00Z'));

      const result = await acquire();

      expect(result.refusal).toBe(AcquireRefusal.DOES_NOT_FIT);
    });

    it('waits out a request in flight on a claimed victim, then stops it when the last one leaves', async () => {
      const instance = victim();
      const lease = await instanceLeaseService.lease(OTHER_DEPLOYMENT, [instance]);

      refuse();
      planner.plan.mockResolvedValue(planFor(instance));
      instanceService.findByDeploymentId.mockImplementation(deploymentId =>
        Promise.resolve(deploymentId === OTHER_DEPLOYMENT ? [instance] : rows)
      );

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(instanceService.takeDown).not.toHaveBeenCalledWith([instance], expect.anything());

      lease?.release();

      await vi.waitFor(() =>
        expect(instanceService.takeDown).toHaveBeenCalledWith(
          [instance],
          expect.objectContaining({ reason: InstanceChangeReason.EVICTED })
        )
      );
    });

    it('leaves a claimed victim draining when its own deployment reconciles', async () => {
      const instance = victim();
      const lease = await instanceLeaseService.lease(OTHER_DEPLOYMENT, [instance]);

      refuse();
      planner.plan.mockResolvedValue(planFor(instance));
      instanceService.findByDeploymentId.mockImplementation(deploymentId =>
        Promise.resolve(deploymentId === OTHER_DEPLOYMENT ? [instance] : rows)
      );

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);
      await deploymentSupervisorService.reconcile(OTHER_DEPLOYMENT);

      expect(instanceLeaseService.isDraining(instance)).toBe(true);

      lease?.release();
    });

    it('takes a hand start through room making only when the operator confirmed', async () => {
      const start = vi.fn().mockResolvedValue({ started: [], refused: [], evicting: [] });

      Object.assign(instanceService, { start });

      await deploymentSupervisorService.startByHand(DEPLOYMENT_ID, 1, false);
      await deploymentSupervisorService.startByHand(DEPLOYMENT_ID, 1, true);

      expect(start.mock.calls[0][2]).toBeNull();
      expect(start.mock.calls[1][2]).toEqual(expect.any(Function));
    });

    it('stands a hand start with a mark, so it finishes starting with no waiting request', async () => {
      deployment.activationPolicy = ActivationPolicy.ON_DEMAND;
      refuse();
      planner.plan.mockResolvedValueOnce(planFor(victim()));

      const start = vi.fn((_id: number, _actor: number, maker: RoomMaker) => maker(deployment, [REFUSED], []));

      Object.assign(instanceService, { start });

      await deploymentSupervisorService.startByHand(DEPLOYMENT_ID, 1, true);
      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(instanceService.bringUp).toHaveBeenCalled();
    });
  });

  describe('restarting onto the latest settings', () => {
    const OLDER_REVISION = 'b'.repeat(64);

    const older = (id: number, overrides: Partial<Instance> = {}): Instance =>
      instanceOf(id, InstanceState.READY, {
        configurationRevision: OLDER_REVISION,
        restartRequestedDate: new Date(),
        ...overrides,
      });

    const reconcile = () => deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

    /** Starting a replacement calls `takeDown` to remove failed instance rows. */
    const stops = () => instanceService.takeDown.mock.calls.filter(([instances]) => instances.length > 0);

    it('restarts idle instances immediately and records matching stop and start reasons', async () => {
      const instance = older(1);

      rows = [instance];

      await reconcile();

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        [instance],
        expect.objectContaining({ reason: InstanceChangeReason.SETTINGS_CHANGED })
      );

      await reconcile();

      expect(instanceService.bringUp).toHaveBeenCalledWith(
        DEPLOYMENT_ID,
        expect.objectContaining({ reason: InstanceChangeReason.SETTINGS_CHANGED })
      );
    });

    it('waits for the last active request before restarting', async () => {
      const instance = older(1);

      rows = [instance];

      const { lease } = await acquire();

      await reconcile();

      expect(instanceService.takeDown).not.toHaveBeenCalled();

      lease?.release();

      await vi.waitFor(() => expect(instanceService.takeDown).toHaveBeenCalled());
    });

    it('restarts an idle replica while another serves', async () => {
      const busy = older(1);
      const idle = older(2);

      rows = [busy, idle];

      await acquire();
      await reconcile();

      expect(instanceService.takeDown).toHaveBeenCalledExactlyOnceWith([idle], expect.anything());
    });

    it('restarts one instance at a time, waiting on the replacement', async () => {
      rows = [older(1), older(2)];

      await reconcile();
      await reconcile();
      await reconcile();

      expect(stops()).toHaveLength(1);

      report(rows.map(row => Object.assign(row, { instanceState: InstanceState.READY })));

      await vi.waitFor(() => expect(stops()).toHaveLength(2));
    });

    it('skips instances without restart requests', async () => {
      rows = [older(1, { restartRequestedDate: null })];

      await reconcile();

      expect(instanceService.takeDown).not.toHaveBeenCalled();
    });

    it('clears the restart request when saved settings match the launch revision', async () => {
      const instance = older(1, { configurationRevision: deployment.configurationRevision });

      rows = [instance];

      await reconcile();

      expect(instanceService.takeDown).not.toHaveBeenCalled();
      expect(instanceService.clearRestartRequest).toHaveBeenCalledWith([instance]);
    });

    it('cancels the restart and records a refusal when the latest settings no longer fit', async () => {
      const instance = older(1);

      rows = [instance];
      instanceService.restartProblem.mockResolvedValue({
        message: 'rig: Not enough GPU memory for 20.0 GiB',
        outOfRoom: true,
      });

      await reconcile();

      expect(stops()).toHaveLength(0);
      expect(instanceService.clearRestartRequest).toHaveBeenCalledWith([instance]);
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.INSTANCE_START_REFUSED,
        expect.anything(),
        expect.objectContaining({
          detail: expect.objectContaining({ problem: expect.stringContaining('rig') as string }) as object,
        })
      );
    });

    it('keeps the restart request pending after a temporary refusal', async () => {
      rows = [older(1)];
      instanceService.restartProblem.mockResolvedValue({ message: 'rig: No readings', outOfRoom: false });

      await reconcile();

      expect(stops()).toHaveLength(0);
      expect(instanceService.clearRestartRequest).not.toHaveBeenCalledWith(rows);
      expect(eventService.recordEvent).not.toHaveBeenCalled();

      instanceService.restartProblem.mockResolvedValue(null);

      await reconcile();

      expect(stops()).toHaveLength(1);
    });

    it('defers restarts when the same reconcile launches a replica', async () => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;
      rows = [older(1)];

      await reconcile();

      expect(instanceService.bringUp).toHaveBeenCalled();
      expect(stops()).toHaveLength(0);
    });

    it('leaves an instance serving a request that arrived during the fit check', async () => {
      rows = [older(1)];
      instanceService.restartProblem.mockImplementation(async () => {
        await acquire();

        return null;
      });

      await reconcile();

      expect(stops()).toHaveLength(0);
      expect(deploymentSupervisorService.factsFor(deployment, rows).restarting).toBe(false);
    });

    it('skips replacement when the instance is manually stopped during the capacity check', async () => {
      rows = [older(1)];
      instanceService.restartProblem.mockImplementation(() => {
        rows = [];

        return Promise.resolve(null);
      });

      await reconcile();

      expect(stops()).toHaveLength(0);
      expect(deploymentSupervisorService.factsFor(deployment, rows).restarting).toBe(false);
    });

    it('allows restarts despite a failed replica on older settings', async () => {
      const failed = instanceOf(2, InstanceState.FAILED, { configurationRevision: OLDER_REVISION });

      rows = [older(1), failed];

      await reconcile();

      expect(stops()).toHaveLength(1);
    });

    it('blocks further restarts after a replacement fails on the latest settings', async () => {
      rows = [older(1), instanceOf(2, InstanceState.FAILED)];

      await reconcile();

      expect(stops()).toHaveLength(0);
    });

    it('skips instances on disconnected nodes', async () => {
      rows = [older(1)];
      agentConnectionService.relayFor.mockReturnValue(null);

      await reconcile();

      expect(instanceService.takeDown).not.toHaveBeenCalled();
    });

    it('reports a restart in progress until the replacement starts', async () => {
      rows = [older(1)];

      await reconcile();

      expect(deploymentSupervisorService.factsFor(deployment, rows).restarting).toBe(true);

      await reconcile();

      expect(deploymentSupervisorService.factsFor(deployment, rows).restarting).toBe(false);
    });
  });

  describe('a ready deployment', () => {
    it('leases a ready instance at once, stamping the deployment as used', async () => {
      rows = [instanceOf(1, InstanceState.READY)];

      const result = await acquire();

      expect(result.lease).toMatchObject({ instanceKey: rows[0].instanceKey, relay: RELAY });
      expect(result.waitedMs).toBeNull();
      expect(deploymentService.stampLastUsed).toHaveBeenCalledWith(DEPLOYMENT_ID);
    });

    it('answers a request whose caller is already gone without reading anything', async () => {
      const controller = new AbortController();

      controller.abort();

      await expect(acquire({ signal: controller.signal })).resolves.toMatchObject({ lease: null, refusal: null });
      expect(instanceService.findForRouting).not.toHaveBeenCalled();
    });

    it('refuses a ready instance on a node out of contact at once, starting nothing', async () => {
      rows = [instanceOf(1, InstanceState.READY)];
      agentConnectionService.relayFor.mockReturnValue(null);

      const result = await acquire();

      expect(result.refusal).toBe(AcquireRefusal.NOT_AVAILABLE);
      expect(instanceService.bringUp).not.toHaveBeenCalled();
      expect(deploymentService.stampLastUsed).not.toHaveBeenCalled();
    });
  });

  describe('a cold deployment', () => {
    it('starts it for the request and leases the instance once the node reports it ready', async () => {
      const { acquiring } = await waiting();

      expect(instanceService.bringUp).toHaveBeenCalledWith(DEPLOYMENT_ID, {
        actorId: null,
        reason: InstanceChangeReason.ON_REQUEST,
        note: ' to serve a request',
      });

      report([instanceOf(10, InstanceState.READY)]);

      const result = await acquiring;

      expect(result.lease?.instanceKey).toBe(instanceOf(10, InstanceState.READY).instanceKey);
      expect(result.waitedMs).not.toBeNull();
    });

    it('starts one instance however many requests arrive together, and leases it to them all', async () => {
      const acquirings = [acquire(), acquire(), acquire()];

      await vi.waitFor(() => expect(instanceService.bringUp).toHaveBeenCalled());
      await new Promise(resolve => setTimeout(resolve, 10));

      report([instanceOf(10, InstanceState.READY)]);

      const results = await Promise.all(acquirings);

      expect(instanceService.bringUp).toHaveBeenCalledTimes(1);
      expect(results.map(result => result.lease?.nodeId)).toEqual([10, 10, 10]);
    });

    it('joins an instance already starting rather than starting another', async () => {
      rows = [instanceOf(1, InstanceState.STARTING)];

      await waiting();

      expect(instanceService.bringUp).not.toHaveBeenCalled();
    });

    it('refuses at once, waiting on nothing, where the pinned GPUs have no room', async () => {
      const onWait = vi.fn();

      instanceService.bringUp.mockResolvedValue({
        started: [],
        refused: [
          {
            nodeId: 1,
            problem: 'Not enough GPU memory for 20.0 GiB',
            capacity: {} as IFitReport,
          } as INodePlacement,
        ],
      });

      const result = await acquire({ onWait });

      expect(result).toMatchObject({
        refusal: AcquireRefusal.DOES_NOT_FIT,
        problem: 'Not enough GPU memory for 20.0 GiB',
      });
      expect(onWait).not.toHaveBeenCalled();
    });

    it('refuses a disabled deployment', async () => {
      deployment.enabled = false;

      const result = await acquire();

      expect(result.refusal).toBe(AcquireRefusal.CANNOT_START);
      expect(instanceService.bringUp).not.toHaveBeenCalled();
    });

    it("refuses its waiters with the backend's output when the start fails", async () => {
      const { acquiring } = await waiting();

      deployment.launchFailures = 1;
      deployment.lastLaunchFailureDate = new Date();
      deployment.lastLaunchFailure = 'CUDA out of memory';
      report([instanceOf(10, InstanceState.FAILED)]);

      await expect(acquiring).resolves.toMatchObject({
        refusal: AcquireRefusal.FAILED,
        problem: 'CUDA out of memory',
      });
    });

    it('refuses at once while its last start failed too recently, starting nothing', async () => {
      deployment.launchFailures = 1;
      deployment.lastLaunchFailureDate = new Date(Date.now() - 10_000);
      deployment.lastLaunchFailure = 'CUDA out of memory';
      rows = [instanceOf(1, InstanceState.FAILED)];

      const result = await acquire();

      expect(result).toMatchObject({ refusal: AcquireRefusal.BACKING_OFF, problem: 'CUDA out of memory' });
      expect(result.retryInMs).toBeGreaterThan(19_000);
      expect(instanceService.bringUp).not.toHaveBeenCalled();
    });

    it("refuses at once once it has been given up on, with the backend's output, starting nothing", async () => {
      deployment.launchFailures = LAUNCH_FAILURE_LIMIT;
      deployment.lastLaunchFailureDate = new Date(Date.now() - 3_600_000);
      deployment.lastLaunchFailure = 'weights are corrupt';
      rows = [instanceOf(1, InstanceState.FAILED)];

      const result = await acquire();

      expect(result).toMatchObject({ refusal: AcquireRefusal.GIVEN_UP, problem: 'weights are corrupt' });
      expect(instanceService.bringUp).not.toHaveBeenCalled();
    });

    it('starts as before while its run is one short of the limit', async () => {
      deployment.launchFailures = LAUNCH_FAILURE_LIMIT - 1;
      deployment.lastLaunchFailureDate = new Date(Date.now() - 3_600_000);

      const { acquiring } = await waiting();

      report([instanceOf(10, InstanceState.READY)]);

      await expect(acquiring).resolves.toMatchObject({ refusal: null });
      expect(instanceService.bringUp).toHaveBeenCalledTimes(1);
    });

    it('refuses a request whose deployment cannot be read, rather than leaving it to time out', async () => {
      instanceService.findByDeploymentId.mockRejectedValue(new Error('the database went away'));

      await expect(acquire()).resolves.toMatchObject({ refusal: AcquireRefusal.NOT_AVAILABLE });
    });

    it('holds a request no longer than its maximum, however long the start it waits behind takes', async () => {
      instanceService.bringUp.mockReturnValue(new Promise(() => undefined));

      await expect(acquire({ maxWaitMs: 20 })).resolves.toMatchObject({ refusal: AcquireRefusal.TIMED_OUT });
    });

    it('backs off from a failure recorded between reading the rows and reading the deployment', async () => {
      const failed = instanceOf(10, InstanceState.FAILED);
      const { acquiring } = await waiting();

      instanceService.findByDeploymentId.mockImplementationOnce(() => {
        deployment.launchFailures = 1;
        deployment.lastLaunchFailureDate = new Date();
        deployment.lastLaunchFailure = 'CUDA out of memory';

        return Promise.resolve([failed]);
      });
      rows = [failed];
      changes.next([DEPLOYMENT_ID]);

      await expect(acquiring).resolves.toMatchObject({ refusal: AcquireRefusal.FAILED });
      expect(instanceService.bringUp).toHaveBeenCalledTimes(1);
    });

    it('starts again, and refuses with its reason, where the only instance is starting on a node out of contact', async () => {
      rows = [instanceOf(1, InstanceState.STARTING)];
      agentConnectionService.relayFor.mockReturnValue(null);
      instanceService.bringUp.mockResolvedValue({
        started: [],
        refused: [{ nodeId: 1, problem: 'This node is offline' } as INodePlacement],
      });

      await expect(acquire()).resolves.toMatchObject({
        refusal: AcquireRefusal.CANNOT_START,
        problem: 'This node is offline',
      });
    });

    it('refuses a waiter whose ready instance turned up only on a node out of contact', async () => {
      const { acquiring } = await waiting();

      agentConnectionService.relayFor.mockReturnValue(null);
      report([instanceOf(10, InstanceState.READY)]);

      await expect(acquiring).resolves.toMatchObject({ refusal: AcquireRefusal.NOT_AVAILABLE });
    });

    it('releases a lease that reaches a waiter which has already left', async () => {
      const controller = new AbortController();
      const { promise: stamping, resolve: stamped } = Promise.withResolvers<undefined>();
      const { acquiring } = await waiting({ signal: controller.signal });

      deploymentService.stampLastUsed.mockImplementationOnce(() => stamping);
      report([instanceOf(10, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) })]);
      await vi.waitFor(() => expect(deploymentService.stampLastUsed).toHaveBeenCalled());

      controller.abort();
      stamped(undefined);
      await acquiring;
      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ reason: InstanceChangeReason.IDLE_TIMEOUT })
      );
    });

    it('starts afresh for a request that arrived while an idle stop was taking the deployment away', async () => {
      const { promise: stopping, resolve: stopped } = Promise.withResolvers<undefined>();
      const idle = instanceOf(1, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) });

      rows = [idle];
      instanceService.takeDown.mockImplementationOnce(() => stopping.then(() => undefined));

      const passing = deploymentSupervisorService.pass();

      await vi.waitFor(() => expect(instanceService.takeDown).toHaveBeenCalled());

      const acquiring = acquire();

      rows = [];
      stopped(undefined);
      await passing;

      await vi.waitFor(() => expect(instanceService.bringUp).toHaveBeenCalled());
      report([instanceOf(10, InstanceState.READY)]);

      expect((await acquiring).lease?.nodeId).toBe(10);
    });

    it('lets a request that leaves stop waiting, leaving the instance starting', async () => {
      const controller = new AbortController();
      const { acquiring } = await waiting({ signal: controller.signal });

      controller.abort();

      await expect(acquiring).resolves.toMatchObject({ lease: null, refusal: null });
      expect(instanceService.takeDown.mock.calls.every(([instances]) => instances.length === 0)).toBe(true);
    });

    it('answers whoever waits on a deployment that is deleted', async () => {
      const { acquiring } = await waiting();

      removed.next(DEPLOYMENT_ID);

      await expect(acquiring).resolves.toMatchObject({ refusal: AcquireRefusal.NOT_AVAILABLE });
    });
  });

  it('stops reconciling on changes once it is torn down', async () => {
    deploymentSupervisorService.onModuleDestroy();

    changes.next([DEPLOYMENT_ID]);
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(instanceService.findByDeploymentId).not.toHaveBeenCalled();
    expect(deploymentService.findWithThrow).not.toHaveBeenCalled();
  });

  it('lets go of the refusal it recorded for a deployment that is deleted', () => {
    const forget = vi.spyOn(deploymentActionsService, 'forget');

    removed.next(DEPLOYMENT_ID);

    expect(forget).toHaveBeenCalledWith(DEPLOYMENT_ID);
  });

  it('reconciles a deployment the moment it is edited, enabled or disabled', async () => {
    const changed = new Subject<number>();

    Object.assign(deploymentService, { deploymentChanged: () => changed });
    deploymentSupervisorService.onModuleDestroy();
    deploymentSupervisorService.onModuleInit();

    changed.next(DEPLOYMENT_ID);

    await vi.waitFor(() => expect(instanceService.findByDeploymentId).toHaveBeenCalled());
  });

  describe('reconciling one deployment', () => {
    it('acts on the deployment named and reads no other', async () => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;

      await deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      expect(deploymentService.findAll).not.toHaveBeenCalled();
      expect(instanceService.findByDeploymentId.mock.calls).toEqual([[DEPLOYMENT_ID]]);
      expect(deploymentService.findWithThrow.mock.calls).toEqual([[DEPLOYMENT_ID]]);
      expect(instanceService.bringUp).toHaveBeenCalledWith(DEPLOYMENT_ID, expect.anything());
    });

    it('joins a reconcile already running, resolving only once it has run again and settled', async () => {
      const { promise: stopping, resolve: stopped } = Promise.withResolvers<undefined>();
      let settled = false;

      rows = [instanceOf(1, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) })];
      instanceService.takeDown.mockImplementationOnce(() => stopping.then(() => undefined));

      const running = deploymentSupervisorService.reconcile(DEPLOYMENT_ID);

      await vi.waitFor(() => expect(instanceService.takeDown).toHaveBeenCalled());

      const joining = deploymentSupervisorService.reconcile(DEPLOYMENT_ID).then(() => {
        settled = true;

        return instanceService.findByDeploymentId.mock.calls.length;
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(settled).toBe(false);

      stopped(undefined);

      expect(await joining).toBe(2);
      await running;
    });
  });

  describe('a pass', () => {
    it('reconciles every deployment there is', async () => {
      deploymentService.findAll.mockResolvedValue([deployment, buildDeployment({ id: DEPLOYMENT_ID + 1 })]);

      await deploymentSupervisorService.pass();

      expect(instanceService.findByDeploymentId.mock.calls).toEqual([[DEPLOYMENT_ID], [DEPLOYMENT_ID + 1]]);
      expect(deploymentService.findWithThrow.mock.calls).toEqual([[DEPLOYMENT_ID], [DEPLOYMENT_ID + 1]]);
    });

    it('keeps an always deployment resident', async () => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;

      await deploymentSupervisorService.pass();

      expect(instanceService.bringUp).toHaveBeenCalledWith(
        DEPLOYMENT_ID,
        expect.objectContaining({ reason: InstanceChangeReason.ALWAYS_POLICY })
      );
    });

    it('starts nothing for an always deployment given up on, however long ago its last start failed', async () => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;
      deployment.launchFailures = LAUNCH_FAILURE_LIMIT;
      deployment.lastLaunchFailureDate = new Date(Date.now() - 3_600_000);
      rows = [instanceOf(1, InstanceState.FAILED)];

      await deploymentSupervisorService.pass();

      expect(instanceService.bringUp).not.toHaveBeenCalled();
      expect(instanceService.takeDown).not.toHaveBeenCalled();
    });

    it('stops an onDemand deployment idle past its timeout', async () => {
      const idle = instanceOf(1, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) });

      rows = [idle];

      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        [idle],
        expect.objectContaining({ reason: InstanceChangeReason.IDLE_TIMEOUT })
      );
    });

    it('counts idleness from when the newest instance became ready, not from when it was created', async () => {
      rows = [
        instanceOf(1, InstanceState.READY, {
          createdDate: new Date(Date.now() - 3_600_000),
          readyDate: new Date(Date.now() - 60_000),
        }),
      ];

      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).not.toHaveBeenCalled();
    });

    it('holds an idle stop off while a request is in flight', async () => {
      rows = [instanceOf(1, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) })];

      const held = await acquire();

      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).not.toHaveBeenCalled();

      held.lease?.release();
    });

    it('keeps a disabled deployment resident until the request it is serving finishes, routing nothing new to it', async () => {
      rows = [instanceOf(1, InstanceState.READY)];

      const serving = await acquire();

      deployment.enabled = false;
      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).not.toHaveBeenCalled();

      await expect(acquire()).resolves.toMatchObject({ lease: null, refusal: AcquireRefusal.CANNOT_START });

      serving.lease?.release();
      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ reason: InstanceChangeReason.DEPLOYMENT_DISABLED })
      );
    });

    it('hands a deployment enabled again mid-request back to the gateway', async () => {
      rows = [instanceOf(1, InstanceState.READY)];

      const serving = await acquire();

      deployment.enabled = false;
      await deploymentSupervisorService.pass();

      deployment.enabled = true;
      await deploymentSupervisorService.pass();

      expect((await acquire()).lease).not.toBeNull();

      serving.lease?.release();
    });

    it('stops a disabled deployment the moment the last request it was serving finishes', async () => {
      rows = [instanceOf(1, InstanceState.READY)];

      const serving = await acquire();

      deployment.enabled = false;
      await deploymentSupervisorService.pass();
      serving.lease?.release();

      await vi.waitFor(() =>
        expect(instanceService.takeDown).toHaveBeenCalledWith(
          expect.any(Array),
          expect.objectContaining({ reason: InstanceChangeReason.DEPLOYMENT_DISABLED })
        )
      );
    });

    it('stops an idle deployment once the request it held off for finishes', async () => {
      rows = [instanceOf(1, InstanceState.READY, { readyDate: new Date(Date.now() - 3_600_000) })];

      const held = await acquire();

      await deploymentSupervisorService.pass();
      held.lease?.release();
      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ reason: InstanceChangeReason.IDLE_TIMEOUT })
      );
    });

    it('holds an idle stop off while an instance is still starting, however long its launch takes', async () => {
      rows = [instanceOf(1, InstanceState.STARTING, { createdDate: new Date(Date.now() - 3_600_000) })];

      await deploymentSupervisorService.pass();

      expect(instanceService.takeDown).not.toHaveBeenCalled();
    });
  });

  describe('giving up', () => {
    const countOf = (launchFailures: number, output: string | null = 'weights are corrupt'): ILaunchFailureCount => ({
      deploymentId: DEPLOYMENT_ID,
      name: 'chat-8b',
      launchFailures,
      output,
    });

    it('records giving up with the run the count reached, even where the run was cleared since', async () => {
      deployment.launchFailures = 0;

      counted.next(countOf(LAUNCH_FAILURE_LIMIT));

      await vi.waitFor(() => expect(eventService.recordEvent).toHaveBeenCalled());

      expect(eventService.recordEvent.mock.calls[0]).toMatchObject([
        EventType.DEPLOYMENT_GIVEN_UP,
        expect.anything(),
        {
          subjectId: `${DEPLOYMENT_ID}`,
          detail: { launchFailures: LAUNCH_FAILURE_LIMIT, output: 'weights are corrupt' },
        },
      ]);
    });

    it('records nothing for a failed start short of the limit or past it, nor for reconciling one given up on', async () => {
      deployment.activationPolicy = ActivationPolicy.ALWAYS;
      deployment.launchFailures = LAUNCH_FAILURE_LIMIT + 1;

      counted.next(countOf(LAUNCH_FAILURE_LIMIT - 1));
      counted.next(countOf(LAUNCH_FAILURE_LIMIT + 1));
      await deploymentSupervisorService.pass();
      await deploymentSupervisorService.pass();

      expect(eventService.recordEvent).not.toHaveBeenCalledWith(
        EventType.DEPLOYMENT_GIVEN_UP,
        expect.anything(),
        expect.anything()
      );
    });

    it('leaves the output out of the event where the backend wrote none', async () => {
      counted.next(countOf(LAUNCH_FAILURE_LIMIT, null));

      await vi.waitFor(() => expect(eventService.recordEvent).toHaveBeenCalled());

      expect(eventService.recordEvent.mock.calls[0][2]).toMatchObject({
        detail: { name: 'chat-8b', launchFailures: LAUNCH_FAILURE_LIMIT },
      });
      expect(eventService.recordEvent.mock.calls[0][2]).not.toHaveProperty('detail.output');
    });

    it('keeps supervising where the event cannot be written', async () => {
      eventService.recordEvent.mockRejectedValue(new Error('the database went away'));

      counted.next(countOf(LAUNCH_FAILURE_LIMIT));
      await vi.waitFor(() => expect(eventService.recordEvent).toHaveBeenCalled());

      counted.next(countOf(LAUNCH_FAILURE_LIMIT));

      await vi.waitFor(() => expect(eventService.recordEvent).toHaveBeenCalledTimes(2));
    });
  });
});
