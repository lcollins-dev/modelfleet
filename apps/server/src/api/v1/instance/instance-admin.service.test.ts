import { Test } from '@nestjs/testing';
import { Subject, Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState as ProtocolInstanceState } from '@libs/agent-protocol';
import { BackendId, GIB, LaunchMode } from '@libs/backends';
import {
  ActivationPolicy,
  ExpectedUsageSource,
  DeploymentInstancesResponseDto,
  InstanceListResponseDto,
  InstanceState,
  NodeState,
  ResidencyRule,
} from '@libs/dto';

import { InstanceAdminService } from './instance-admin.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { InstanceService } from '@/core/instance/instance.service';
import { FitRefusal, IFitReport } from '@/core/ledger/vram-ledger.service';
import { NodeStateService } from '@/core/node/node-state.service';
import { NodeService } from '@/core/node/node.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';
import { SupervisorPolicyService } from '@/core/supervisor/supervisor-policy.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { buildDeployment, TEST_DEPLOYMENT_ID } from '@/test/deployment.factory';
import { buildInstance, buildObservedInstance, TEST_DEVICE_KEY, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { buildNode, TEST_NODE_ID } from '@/test/node.factory';

const TOO_LARGE: IFitReport = {
  launchMode: LaunchMode.GPU_ONLY,
  expectedBytes: 20 * GIB,
  cards: [
    {
      deviceKey: TEST_DEVICE_KEY,
      totalBytes: 80 * GIB,
      usedBytes: 60 * GIB,
      predictedBytes: 8 * GIB,
      headroomBytes: GIB,
      freeBytes: 12 * GIB,
      neededBytes: null,
    },
  ],
  hostFreeBytes: null,
  availableBytes: 11 * GIB,
  hostWeights: null,
  shortCard: null,
  refusal: FitRefusal.TOO_LARGE,
};

const TOO_LARGE_CAPACITY = {
  expectedBytes: 20 * GIB,
  availableBytes: 11 * GIB,
  hostFreeBytes: null,
  hostWeights: null,
  cards: [
    {
      deviceKey: TEST_DEVICE_KEY,
      name: 'NVIDIA A100-SXM4-80GB',
      totalBytes: 80 * GIB,
      usedBytes: 60 * GIB,
      predictedBytes: 8 * GIB,
      headroomBytes: GIB,
      freeBytes: 12 * GIB,
    },
  ],
};

const REPORTED_DATE = new Date('2026-08-20T12:00:00.000Z');

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('InstanceAdminService', () => {
  let deploymentChanged: Subject<number>;
  let deploymentRemoved: Subject<number>;
  let deploymentService: {
    deploymentChanged: () => Subject<number>;
    deploymentRemoved: () => Subject<number>;
    findWithThrow: ReturnType<typeof vi.fn>;
  };
  let gpuService: { findByNodeId: ReturnType<typeof vi.fn> };
  let instancesChanged: Subject<void>;
  let instanceService: {
    findAll: ReturnType<typeof vi.fn>;
    findByDeploymentId: ReturnType<typeof vi.fn>;
    findByNodeId: ReturnType<typeof vi.fn>;
    instancesChanged: () => Subject<void>;
    previewPlacements: ReturnType<typeof vi.fn>;
    previewDraft: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  let nodeService: {
    find: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  let nodeStateService: { getObserved: ReturnType<typeof vi.fn> };
  let deploymentSupervisorService: { factsFor: ReturnType<typeof vi.fn> };
  let telemetryChanged: Subject<number>;
  let instanceAdminService: InstanceAdminService;

  const resident = (...overrides: Partial<ReturnType<typeof buildInstance>>[]) => {
    const instance = buildInstance(overrides[0] ?? {});

    instance.deployment = buildDeployment();
    instance.node = buildNode();

    return [instance];
  };

  beforeEach(async () => {
    deploymentChanged = new Subject<number>();
    deploymentRemoved = new Subject<number>();

    deploymentService = {
      deploymentChanged: () => deploymentChanged,
      deploymentRemoved: () => deploymentRemoved,
      findWithThrow: vi.fn().mockResolvedValue(buildDeployment()),
    };

    gpuService = {
      findByNodeId: vi.fn().mockResolvedValue([{ deviceKey: TEST_DEVICE_KEY, name: 'NVIDIA A100-SXM4-80GB' }]),
    };

    instancesChanged = new Subject<void>();

    instanceService = {
      findAll: vi.fn().mockResolvedValue(resident()),
      findByDeploymentId: vi.fn().mockResolvedValue(resident()),
      findByNodeId: vi.fn().mockResolvedValue(resident()),
      previewPlacements: vi.fn().mockResolvedValue({
        placements: [{ nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null }],
        replicas: 1,
        problem: null,
      }),
      previewDraft: vi.fn().mockResolvedValue({
        placements: [
          {
            nodeId: TEST_NODE_ID,
            pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
            problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
            capacity: TOO_LARGE,
            expected: {
              known: true,
              bytes: 20 * GIB,
              source: ExpectedUsageSource.ESTIMATED,
              hostWeightsBytes: 0,
              hostResidentBytes: 0,
            },
          },
        ],
        replicas: 1,
        problem: null,
      }),
      instancesChanged: () => instancesChanged,
      start: vi.fn(),
    };

    nodeService = {
      find: vi.fn().mockResolvedValue(buildNode()),
      findWithThrow: vi.fn().mockResolvedValue(buildNode()),
      getState: vi.fn().mockReturnValue(NodeState.ONLINE),
    };

    nodeStateService = { getObserved: vi.fn().mockReturnValue(null) };
    deploymentSupervisorService = {
      factsFor: vi.fn().mockReturnValue({
        activationPolicy: ActivationPolicy.ALWAYS,
        enabled: true,
        resident: 1,
        inFlight: 2,
        idleTimeoutMs: 900_000,
        idleSince: null,
        backoffUntil: null,
        givenUp: false,
        now: REPORTED_DATE,
      }),
    };

    telemetryChanged = new Subject<number>();

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceAdminService,
        { provide: DeploymentService, useValue: deploymentService },
        { provide: GpuService, useValue: gpuService },
        { provide: InstanceService, useValue: instanceService },
        { provide: NodeService, useValue: nodeService },
        { provide: NodeStateService, useValue: nodeStateService },
        { provide: SupervisorPolicyService, useValue: new SupervisorPolicyService() },
        { provide: DeploymentSupervisorService, useValue: deploymentSupervisorService },
        { provide: TelemetryService, useValue: { telemetryChanged: () => telemetryChanged } },
      ],
    }).compile();

    instanceAdminService = moduleRef.get(InstanceAdminService);
  });

  it('names the node, the state and the device the instance is pinned to', async () => {
    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances).toEqual([
      expect.objectContaining({
        instanceKey: TEST_INSTANCE_KEY,
        nodeName: 'rig-01',
        nodeState: NodeState.ONLINE,
        state: InstanceState.STARTING,
        devices: [{ deviceKey: TEST_DEVICE_KEY, name: 'NVIDIA A100-SXM4-80GB' }],
      }),
    ]);
  });

  it("lists an instance's devices in the node's order rather than the order they were pinned in", async () => {
    gpuService.findByNodeId.mockResolvedValue([
      { deviceKey: 'GPU-b', name: 'RTX 3090' },
      { deviceKey: 'GPU-a', name: 'RTX 4090' },
    ]);
    instanceService.findByDeploymentId.mockResolvedValue(
      resident({ pins: { cpu: false, gpus: ['GPU-gone', 'GPU-a', 'GPU-b'] } })
    );

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances[0].devices).toEqual([
      { deviceKey: 'GPU-b', name: 'RTX 3090' },
      { deviceKey: 'GPU-a', name: 'RTX 4090' },
      { deviceKey: 'GPU-gone', name: null },
    ]);
  });

  it('reads an instance on the node CPU as taking no devices', async () => {
    instanceService.findByDeploymentId.mockResolvedValue(resident({ pins: { cpu: true, gpus: [] } }));

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances[0].devices).toEqual([]);
  });

  it("carries the backend's own output and exit code of a failed instance", async () => {
    instanceService.findByDeploymentId.mockResolvedValue(
      resident({
        instanceState: ProtocolInstanceState.FAILED,
        message: 'error: unknown argument: --invented-flag',
        exitCode: 1,
      })
    );

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances[0]).toMatchObject({
      state: InstanceState.FAILED,
      message: 'error: unknown argument: --invented-flag',
      exitCode: 1,
    });
  });

  it("reads the start time back from the node's live report", async () => {
    nodeStateService.getObserved.mockReturnValue({
      desiredGeneration: 1,
      instances: [buildObservedInstance({ uptimeMs: 60_000 })],
      reportedDate: REPORTED_DATE,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances[0].startedDate).toEqual(new Date('2026-08-20T11:59:00.000Z'));
  });

  it('reads no start time while the node has reported nothing', async () => {
    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.instances[0].startedDate).toBeNull();
  });

  it('says which rule holds the deployment, and what is in flight against it', async () => {
    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.residency).toEqual({
      rule: ResidencyRule.ALWAYS,
      idleTimeoutMs: null,
      lastUsedDate: null,
      idleSince: null,
      inFlight: 2,
      launchFailures: 0,
      retryDate: null,
      givenUp: false,
      lastLaunchFailure: null,
    });
  });

  it('names the idle timeout and what it is counted from for an onDemand deployment', async () => {
    const lastUsedDate = new Date('2026-08-20T11:50:00.000Z');

    deploymentService.findWithThrow.mockResolvedValue(
      buildDeployment({ activationPolicy: ActivationPolicy.ON_DEMAND, lastUsedDate })
    );
    deploymentSupervisorService.factsFor.mockReturnValue({
      activationPolicy: ActivationPolicy.ON_DEMAND,
      enabled: true,
      resident: 1,
      inFlight: 0,
      idleTimeoutMs: 1_800_000,
      idleSince: lastUsedDate,
      backoffUntil: null,
      givenUp: false,
      now: REPORTED_DATE,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.residency).toEqual({
      rule: ResidencyRule.IDLE_TIMEOUT,
      idleTimeoutMs: 1_800_000,
      lastUsedDate: new Date('2026-08-20T11:50:00.000Z'),
      idleSince: new Date('2026-08-20T11:50:00.000Z'),
      inFlight: 0,
      launchFailures: 0,
      retryDate: null,
      givenUp: false,
      lastLaunchFailure: null,
    });
  });

  it('says how many launches in a row failed, and when the backoff lets the next start go', async () => {
    deploymentService.findWithThrow.mockResolvedValue(buildDeployment({ launchFailures: 2 }));
    deploymentSupervisorService.factsFor.mockReturnValue({
      activationPolicy: ActivationPolicy.ALWAYS,
      enabled: true,
      resident: 0,
      inFlight: 0,
      idleTimeoutMs: 900_000,
      idleSince: null,
      backoffUntil: new Date('2026-08-20T12:00:30Z'),
      givenUp: false,
      now: REPORTED_DATE,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.residency).toMatchObject({ launchFailures: 2, retryDate: new Date('2026-08-20T12:00:30.000Z') });
  });

  it("says a deployment has been given up on, with the backend's last output and no retry to wait for", async () => {
    deploymentService.findWithThrow.mockResolvedValue(
      buildDeployment({ launchFailures: 10, lastLaunchFailure: 'weights are corrupt' })
    );
    deploymentSupervisorService.factsFor.mockReturnValue({
      activationPolicy: ActivationPolicy.ALWAYS,
      enabled: true,
      resident: 0,
      inFlight: 0,
      idleTimeoutMs: 900_000,
      idleSince: null,
      backoffUntil: new Date('2026-08-20T12:10:00Z'),
      givenUp: true,
      now: REPORTED_DATE,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.residency).toMatchObject({
      launchFailures: 10,
      retryDate: null,
      givenUp: true,
      lastLaunchFailure: 'weights are corrupt',
    });
  });

  it('names being disabled as the rule a deployment is held by', async () => {
    deploymentService.findWithThrow.mockResolvedValue(buildDeployment({ enabled: false }));
    deploymentSupervisorService.factsFor.mockReturnValue({
      activationPolicy: ActivationPolicy.ALWAYS,
      enabled: false,
      resident: 0,
      inFlight: 0,
      idleTimeoutMs: 900_000,
      idleSince: null,
      backoffUntil: null,
      givenUp: false,
      now: REPORTED_DATE,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.residency).toMatchObject({ rule: ResidencyRule.DISABLED });
  });

  it('names the devices a start would take on each node, so the screen can say so', async () => {
    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement).toEqual({
      nodes: [
        {
          nodeId: TEST_NODE_ID,
          nodeName: 'rig-01',
          devices: [{ deviceKey: TEST_DEVICE_KEY, name: 'NVIDIA A100-SXM4-80GB' }],
          replicas: 1,
          running: 1,
          problem: null,
          expectedUsage: null,
          capacity: null,
        },
      ],
      problem: null,
    });
  });

  it('names what a node is expected to take, its source and its host weights', async () => {
    instanceService.previewPlacements.mockResolvedValue({
      placements: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: null,
          expected: {
            known: true,
            bytes: 20 * GIB,
            source: ExpectedUsageSource.ESTIMATED,
            hostWeightsBytes: 30 * GIB,
            hostResidentBytes: 6 * GIB,
          },
        },
      ],
      replicas: 1,
      problem: null,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement.nodes[0].expectedUsage).toEqual({
      bytes: 20 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 30 * GIB,
      hostResidentBytes: 6 * GIB,
    });
  });

  it('names a figure measured on an earlier run as measured', async () => {
    instanceService.previewPlacements.mockResolvedValue({
      placements: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: null,
          expected: {
            known: true,
            bytes: 22 * GIB,
            source: ExpectedUsageSource.MEASURED,
            hostWeightsBytes: 0,
            hostResidentBytes: 0,
          },
        },
      ],
      replicas: 1,
      problem: null,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement.nodes[0].expectedUsage).toEqual({
      bytes: 22 * GIB,
      source: ExpectedUsageSource.MEASURED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    });
  });

  it('carries the figures a node was refused on for capacity, naming each card', async () => {
    instanceService.previewPlacements.mockResolvedValue({
      placements: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
          capacity: TOO_LARGE,
        },
      ],
      replicas: 1,
      problem: null,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement.nodes[0].capacity).toEqual(TOO_LARGE_CAPACITY);
  });

  it("lists the cards a node was refused on in the node's order", async () => {
    gpuService.findByNodeId.mockResolvedValue([
      { deviceKey: 'GPU-b', name: 'RTX 3090' },
      { deviceKey: 'GPU-a', name: 'RTX 4090' },
    ]);
    instanceService.previewPlacements.mockResolvedValue({
      placements: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: ['GPU-a', 'GPU-b'] },
          problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
          capacity: {
            ...TOO_LARGE,
            cards: [
              { ...TOO_LARGE.cards[0], deviceKey: 'GPU-a' },
              { ...TOO_LARGE.cards[0], deviceKey: 'GPU-b' },
            ],
          },
        },
      ],
      replicas: 1,
      problem: null,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement.nodes[0].capacity?.cards.map(card => card.deviceKey)).toEqual(['GPU-b', 'GPU-a']);
  });

  it('carries the constraint a node broke beside that node', async () => {
    instanceService.previewPlacements.mockResolvedValue({
      placements: [{ nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: 'This node is offline' }],
      replicas: 1,
      problem: null,
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement.nodes[0].problem).toBe('This node is offline');
  });

  it('names the constraint that stops the deployment as a whole', async () => {
    instanceService.previewPlacements.mockResolvedValue({
      placements: [],
      replicas: 1,
      problem: "Choose one node's CPU or one or more GPUs",
    });

    const response = await instanceAdminService.getDeploymentInstances(TEST_DEPLOYMENT_ID);

    expect(response.placement).toEqual({ nodes: [], problem: "Choose one node's CPU or one or more GPUs" });
  });

  describe('previewPlacement', () => {
    const request = {
      deploymentId: null,
      modelId: 1,
      presetId: null,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ALWAYS,
      document: 'placement:\n  gpus: []\n',
    };

    it('shapes a draft verdict as the deployment screen shapes a saved one', async () => {
      const response = await instanceAdminService.previewPlacement(request);

      expect(instanceService.previewDraft).toHaveBeenCalledWith(
        {
          modelId: 1,
          presetId: null,
          backend: BackendId.LLAMA_CPP,
          activationPolicy: ActivationPolicy.ALWAYS,
          document: request.document,
        },
        null
      );
      expect(response.placement.nodes).toEqual([
        expect.objectContaining({
          nodeName: 'rig-01',
          running: 0,
          expectedUsage: {
            bytes: 20 * GIB,
            source: ExpectedUsageSource.ESTIMATED,
            hostWeightsBytes: 0,
            hostResidentBytes: 0,
          },
          capacity: TOO_LARGE_CAPACITY,
        }),
      ]);
      expect(instanceService.findByDeploymentId).not.toHaveBeenCalled();
    });

    it('names a node that no longer exists by its id beside its problem, rather than refusing the rest', async () => {
      nodeService.find.mockResolvedValue(null);
      instanceService.previewDraft.mockResolvedValue({
        placements: [{ nodeId: 99, pins: { cpu: true, gpus: [] }, problem: 'This deployment is assigned to a node' }],
        replicas: 1,
        problem: null,
      });

      const response = await instanceAdminService.previewPlacement(request);

      expect(response.placement.nodes).toEqual([
        expect.objectContaining({ nodeId: 99, nodeName: 'node 99', problem: 'This deployment is assigned to a node' }),
      ]);
    });

    it('counts what the deployment being edited already runs on each node', async () => {
      const response = await instanceAdminService.previewPlacement({ ...request, deploymentId: TEST_DEPLOYMENT_ID });

      expect(instanceService.previewDraft).toHaveBeenCalledWith(expect.anything(), TEST_DEPLOYMENT_ID);
      expect(response.placement.nodes[0].running).toBe(1);
    });
  });

  it('reports what a start created and the nodes it passed over', async () => {
    instanceService.start.mockResolvedValue({
      started: [buildInstance()],
      refused: [{ nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: 'This node is offline' }],
    });

    const response = await instanceAdminService.startDeployment(TEST_DEPLOYMENT_ID, 1);

    expect(response).toEqual({
      started: 1,
      refused: [{ nodeId: TEST_NODE_ID, nodeName: 'rig-01', problem: 'This node is offline', capacity: null }],
    });
  });

  it('names a refused card the node no longer reports by its key alone', async () => {
    gpuService.findByNodeId.mockResolvedValue([]);
    instanceService.start.mockResolvedValue({
      started: [],
      refused: [
        { nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: 'full', capacity: TOO_LARGE },
      ],
    });

    const response = await instanceAdminService.startDeployment(TEST_DEPLOYMENT_ID, 1);

    expect(response.refused[0].capacity?.cards[0]).toMatchObject({ deviceKey: TEST_DEVICE_KEY, name: null });
  });

  it('carries a refusal for a node with no reading as the need alone, with no cards', async () => {
    instanceService.start.mockResolvedValue({
      started: [],
      refused: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: 'This node has not reported its GPU memory since it connected',
          capacity: { ...TOO_LARGE, cards: [], availableBytes: null, refusal: FitRefusal.NO_TELEMETRY },
        },
      ],
    });

    const response = await instanceAdminService.startDeployment(TEST_DEPLOYMENT_ID, 1);

    expect(response.refused[0].capacity).toEqual({
      expectedBytes: 20 * GIB,
      availableBytes: null,
      hostFreeBytes: null,
      cards: [],
      hostWeights: null,
    });
  });

  it('carries the figures of a node a start refused for capacity', async () => {
    instanceService.start.mockResolvedValue({
      started: [],
      refused: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: 'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
          capacity: TOO_LARGE,
        },
      ],
    });

    const response = await instanceAdminService.startDeployment(TEST_DEPLOYMENT_ID, 1);

    expect(response.refused[0].capacity).toEqual(TOO_LARGE_CAPACITY);
  });

  it('carries the host weights of a node a start refused for system memory, without what loading instances hold', async () => {
    instanceService.start.mockResolvedValue({
      started: [],
      refused: [
        {
          nodeId: TEST_NODE_ID,
          pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
          problem: 'This deployment keeps 30.0 GiB of weights in system memory, more than the node has free',
          capacity: {
            ...TOO_LARGE,
            hostWeights: { neededBytes: 30 * GIB, predictedBytes: 2 * GIB, freeBytes: 12 * GIB },
            refusal: FitRefusal.HOST_MEMORY,
          },
        },
      ],
    });

    const response = await instanceAdminService.startDeployment(TEST_DEPLOYMENT_ID, 1);

    expect(response.refused[0].capacity?.hostWeights).toEqual({ neededBytes: 30 * GIB, freeBytes: 12 * GIB });
  });

  it('names the deployment of each instance resident on a node', async () => {
    const response = await instanceAdminService.getNodeInstances(TEST_NODE_ID);

    expect(response.instances[0].deploymentName).toBe(buildDeployment().name);
  });

  it('reads the fleet again on every write to any instance', async () => {
    const seen: InstanceListResponseDto[] = [];
    const instances = await instanceAdminService.watchInstances();
    const subscription = instances.subscribe(response => seen.push(response));

    instanceService.findAll.mockResolvedValue([]);
    instancesChanged.next();

    await new Promise(resolve => setImmediate(resolve));

    subscription.unsubscribe();

    expect(seen.map(response => response.instances.length)).toEqual([1, 0]);
  });

  describe('watchDeploymentInstances', () => {
    const OTHER_NODE_ID = TEST_NODE_ID + 1;

    let seen: DeploymentInstancesResponseDto[];
    let subscription: Subscription | undefined;

    const placedOn = (nodeId: number, problem: string | null, capacity?: IFitReport) => ({
      placements: [{ nodeId, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem, capacity }],
      replicas: 1,
      problem: null,
    });

    const refusedWith = (usedBytes: number): IFitReport => ({
      ...TOO_LARGE,
      cards: [{ ...TOO_LARGE.cards[0], usedBytes }],
    });

    const watch = async () => {
      const responses = await instanceAdminService.watchDeploymentInstances(TEST_DEPLOYMENT_ID);

      subscription = responses.subscribe(response => seen.push(response));

      await settle();
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });

      seen = [];
      instanceService.previewPlacements.mockResolvedValue(
        placedOn(TEST_NODE_ID, 'This deployment needs 20.0 GiB, more than the pinned GPUs have free', TOO_LARGE)
      );
    });

    afterEach(() => {
      subscription?.unsubscribe();
      vi.useRealTimers();
    });

    it('re-reads the placement on a reading from a node it names', async () => {
      await watch();

      instanceService.previewPlacements.mockResolvedValue(placedOn(TEST_NODE_ID, null));
      telemetryChanged.next(TEST_NODE_ID);

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen.map(response => response.placement.nodes[0].problem)).toEqual([
        'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
        null,
      ]);
    });

    it('sends a refusal with the figures of the latest re-read', async () => {
      await watch();

      instanceService.previewPlacements.mockResolvedValue(
        placedOn(
          TEST_NODE_ID,
          'This deployment needs 20.0 GiB, more than the pinned GPUs have free',
          refusedWith(50 * GIB)
        )
      );
      telemetryChanged.next(TEST_NODE_ID);

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen.map(response => response.placement.nodes[0].capacity?.cards[0].usedBytes)).toEqual([
        60 * GIB,
        50 * GIB,
      ]);
      expect(seen[1].placement.nodes[0].problem).not.toBeNull();
    });

    it('folds a burst of readings into one read', async () => {
      await watch();

      telemetryChanged.next(TEST_NODE_ID);
      telemetryChanged.next(TEST_NODE_ID);
      telemetryChanged.next(TEST_NODE_ID);

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(2);
    });

    it('sends nothing on a reading from a node its placement does not name', async () => {
      await watch();

      telemetryChanged.next(OTHER_NODE_ID);

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(1);
    });

    it('sends nothing on a reading from a node its placement fits', async () => {
      instanceService.previewPlacements.mockResolvedValue(placedOn(TEST_NODE_ID, null));

      await watch();

      telemetryChanged.next(TEST_NODE_ID);

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(1);
    });

    it('watches the nodes the latest read refuses', async () => {
      await watch();

      instanceService.previewPlacements.mockResolvedValue(
        placedOn(OTHER_NODE_ID, 'This deployment needs 20.0 GiB, more than the pinned GPUs have free', TOO_LARGE)
      );
      instancesChanged.next();
      await settle();

      telemetryChanged.next(TEST_NODE_ID);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(2);

      telemetryChanged.next(OTHER_NODE_ID);
      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(3);
    });

    it('reads the placement again on an edit to this deployment, not to another', async () => {
      await watch();

      deploymentChanged.next(TEST_DEPLOYMENT_ID + 1);
      await settle();

      expect(seen).toHaveLength(1);

      instanceService.previewPlacements.mockResolvedValue(placedOn(OTHER_NODE_ID, null));
      deploymentChanged.next(TEST_DEPLOYMENT_ID);
      await settle();

      expect(seen.map(response => response.placement.nodes[0].nodeId)).toEqual([TEST_NODE_ID, OTHER_NODE_ID]);
    });

    it('stays open through a failed read, for the next trigger to fill', async () => {
      await watch();

      deploymentService.findWithThrow.mockRejectedValueOnce(new Error('connection reset'));
      instancesChanged.next();
      await settle();

      instancesChanged.next();
      await settle();

      expect(subscription?.closed).toBe(false);
      expect(seen).toHaveLength(2);
    });

    it('completes once the deployment is removed, and not for another', async () => {
      let completed = false;
      const responses = await instanceAdminService.watchDeploymentInstances(TEST_DEPLOYMENT_ID);

      subscription = responses.subscribe({
        complete: () => {
          completed = true;
        },
      });

      deploymentRemoved.next(TEST_DEPLOYMENT_ID + 1);

      expect(completed).toBe(false);

      deploymentRemoved.next(TEST_DEPLOYMENT_ID);

      expect(completed).toBe(true);
    });
  });
});
