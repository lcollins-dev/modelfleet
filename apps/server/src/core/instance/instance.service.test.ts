import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { BackendId, GIB, LaunchMode } from '@libs/backends';
import { ActivationPolicy, EventPartyType, EventType, ExpectedUsageSource, InstanceChangeReason } from '@libs/dto';

import { Instance } from '@/core/instance/entities/instance.entity';

import { DeploymentService } from '@/core/deployment/deployment.service';
import { EventService } from '@/core/event/event.service';
import { InstanceAdmissionService } from '@/core/instance/instance-admission.service';
import { InstanceDesiredStateService } from '@/core/instance/instance-desired-state.service';
import { InstanceLaunchService } from '@/core/instance/instance-launch.service';
import { InstanceService } from '@/core/instance/instance.service';
import { FitRefusal, IFitReport, VramLedgerService } from '@/core/ledger/vram-ledger.service';
import { NodeService } from '@/core/node/node.service';

import { buildDeployment, TEST_DEPLOYMENT_ID, TEST_REVISION } from '@/test/deployment.factory';
import { buildInstance, TEST_DEVICE_KEY, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { buildNode, TEST_NODE_ID } from '@/test/node.factory';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const TEST_ACTOR_ID = 7;

const TOO_LARGE: IFitReport = {
  launchMode: LaunchMode.GPU_ONLY,
  expectedBytes: 20 * GIB,
  cards: [
    {
      deviceKey: TEST_DEVICE_KEY,
      totalBytes: 24 * GIB,
      usedBytes: 8 * GIB,
      predictedBytes: 0,
      headroomBytes: GIB,
      freeBytes: 16 * GIB,
      neededBytes: null,
    },
  ],
  hostFreeBytes: null,
  availableBytes: 15 * GIB,
  hostWeights: null,
  shortCard: null,
  refusal: FitRefusal.TOO_LARGE,
};

const TOO_LARGE_PROBLEM = 'This deployment needs 20.0 GiB, more than the pinned GPUs have free';

describe('InstanceService', () => {
  let deploymentService: {
    findWithThrow: ReturnType<typeof vi.fn>;
    draft: ReturnType<typeof vi.fn>;
    clearLaunchFailures: ReturnType<typeof vi.fn>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let nodeService: { findWithThrow: ReturnType<typeof vi.fn> };
  let instanceDesiredStateService: { publish: ReturnType<typeof vi.fn> };
  let instanceLaunchService: { resolvePlacements: ReturnType<typeof vi.fn>; replicasOf: ReturnType<typeof vi.fn> };
  let instanceAdmissionService: {
    admit: ReturnType<typeof vi.fn>;
    preview: ReturnType<typeof vi.fn>;
    expectedFor: ReturnType<typeof vi.fn>;
    capacityDetail: ReturnType<typeof vi.fn>;
  };
  let vramLedgerService: { release: ReturnType<typeof vi.fn>; markStopping: ReturnType<typeof vi.fn> };
  let instanceRepository: {
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let instanceService: InstanceService;

  beforeEach(async () => {
    deploymentService = {
      findWithThrow: vi.fn().mockResolvedValue(buildDeployment()),
      draft: vi.fn().mockResolvedValue(buildDeployment()),
      clearLaunchFailures: vi.fn().mockResolvedValue(undefined),
    };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    nodeService = { findWithThrow: vi.fn().mockResolvedValue(buildNode()) };
    instanceDesiredStateService = { publish: vi.fn().mockResolvedValue(undefined) };
    instanceLaunchService = {
      resolvePlacements: vi
        .fn()
        .mockResolvedValue([{ nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null }]),
      replicasOf: vi.fn().mockReturnValue(1),
    };

    instanceAdmissionService = {
      admit: vi.fn().mockResolvedValue({ problem: null }),
      preview: vi.fn().mockResolvedValue({ problem: null }),
      expectedFor: vi.fn().mockResolvedValue(null),
      capacityDetail: vi.fn().mockReturnValue({ expectedBytes: 20 * GIB, availableBytes: 15 * GIB, cards: 'figures' }),
    };
    vramLedgerService = { release: vi.fn(), markStopping: vi.fn() };

    instanceRepository = {
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceService,
        { provide: DeploymentService, useValue: deploymentService },
        { provide: EventService, useValue: eventService },
        { provide: NodeService, useValue: nodeService },
        { provide: VramLedgerService, useValue: vramLedgerService },
        { provide: InstanceAdmissionService, useValue: instanceAdmissionService },
        { provide: InstanceDesiredStateService, useValue: instanceDesiredStateService },
        { provide: InstanceLaunchService, useValue: instanceLaunchService },
        { provide: getRepositoryToken(Instance), useValue: instanceRepository },
      ],
    }).compile();

    instanceService = moduleRef.get(InstanceService);
  });

  it('records the instance against the node and the hardware the placement resolved to', async () => {
    const [instance] = (await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).started;

    expect(instance).toMatchObject({
      deploymentId: TEST_DEPLOYMENT_ID,
      nodeId: TEST_NODE_ID,
      pins: { cpu: false, gpus: [TEST_DEVICE_KEY] },
      configurationRevision: TEST_REVISION,
    });
    expect(instanceRepository.insert).toHaveBeenCalledWith(instance);
  });

  it("keys the instance with a uuidv7, so one node's keys sort by when they were issued", async () => {
    const [instance] = (await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).started;

    expect(instance.instanceKey).toMatch(UUID_V7);
  });

  it('gives each node the placement names an instance of its own', async () => {
    instanceLaunchService.resolvePlacements.mockResolvedValue([
      { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null },
      { nodeId: 99, pins: { cpu: true, gpus: [] }, problem: null },
    ]);

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(2);
    expect(instanceDesiredStateService.publish).toHaveBeenCalledTimes(2);
  });

  it("records the placement's pins on the row, so they outlive a change to the deployment", async () => {
    const pins = { cpu: true, gpus: [TEST_DEVICE_KEY] };

    instanceLaunchService.resolvePlacements.mockResolvedValue([{ nodeId: TEST_NODE_ID, pins, problem: null }]);

    const [instance] = (await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).started;

    expect(instance.pins).toEqual(pins);
  });

  it('creates replicas of the placement on each node it names', async () => {
    instanceLaunchService.replicasOf.mockReturnValue(3);

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(3);
  });

  it('creates only what a node is short of, so a second start tops up rather than doubling', async () => {
    instanceLaunchService.replicasOf.mockReturnValue(3);
    instanceRepository.find.mockResolvedValue([buildInstance(), buildInstance()]);

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(1);
  });

  it('runs two starts for one deployment in turn, so both asking at once start one instance', async () => {
    const written: Instance[] = [];

    instanceRepository.find = vi.fn(() => Promise.resolve([...written]));
    instanceRepository.insert = vi.fn((instance: Instance) => {
      written.push(instance);

      return Promise.resolve();
    });

    const change = { actorId: null, reason: InstanceChangeReason.ON_REQUEST };
    const outcomes = await Promise.all([
      instanceService.bringUp(TEST_DEPLOYMENT_ID, change),
      instanceService.bringUp(TEST_DEPLOYMENT_ID, change),
    ]);

    expect(outcomes.map(outcome => outcome.started.length)).toEqual([1, 0]);
    expect(written).toHaveLength(1);
  });

  it('passes over a node that cannot take one, and starts the rest', async () => {
    instanceLaunchService.resolvePlacements.mockResolvedValue([
      { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null },
      { nodeId: 99, pins: { cpu: true, gpus: [] }, problem: 'This node is offline' },
    ]);

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(1);
    expect(outcome.refused).toEqual([{ nodeId: 99, pins: { cpu: true, gpus: [] }, problem: 'This node is offline' }]);
    expect(instanceDesiredStateService.publish).toHaveBeenCalledExactlyOnceWith(TEST_NODE_ID);
  });

  it('passes over a node without room, carrying the figures that refused it', async () => {
    instanceAdmissionService.admit.mockResolvedValue({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(0);
    expect(outcome.refused).toEqual([expect.objectContaining({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE })]);
    expect(instanceRepository.insert).not.toHaveBeenCalled();
  });

  it('admits each replica on its own, so the second sees the first and stops where the node fills', async () => {
    instanceLaunchService.replicasOf.mockReturnValue(3);
    instanceAdmissionService.admit
      .mockResolvedValueOnce({ problem: null })
      .mockResolvedValueOnce({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(outcome.started).toHaveLength(1);
    expect(outcome.refused).toHaveLength(1);
    expect(instanceAdmissionService.admit).toHaveBeenCalledTimes(2);
  });

  it('admits under the key the row is written with', async () => {
    const [instance] = (await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).started;

    expect(instanceAdmissionService.admit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      instance.instanceKey
    );
  });

  it('releases what the ledger admitted where the write fails', async () => {
    instanceRepository.insert.mockRejectedValue(new Error('connection lost'));

    await expect(instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).rejects.toThrow('connection lost');

    const [, , instanceKey] = instanceAdmissionService.admit.mock.calls[0] as [unknown, unknown, string];

    expect(vramLedgerService.release).toHaveBeenCalledWith(instanceKey);
  });

  it('records a refusal for capacity by hand as an event carrying the figures', async () => {
    instanceAdmissionService.admit.mockResolvedValue({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

    await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_START_REFUSED,
      expect.anything(),
      expect.objectContaining({
        actorType: EventPartyType.USER,
        subjectId: `${TEST_DEPLOYMENT_ID}`,
        detail: expect.objectContaining({ problem: TOO_LARGE_PROBLEM, nodeName: 'rig-01' }) as unknown,
      })
    );
  });

  it("leaves a refusal the loop met to the loop's own record", async () => {
    instanceAdmissionService.admit.mockResolvedValue({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

    await instanceService.bringUp(TEST_DEPLOYMENT_ID, { actorId: null, reason: InstanceChangeReason.ALWAYS_POLICY });

    expect(eventService.recordEvent).not.toHaveBeenCalled();
  });

  it('asks the node for its new set once the row exists', async () => {
    await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(instanceDesiredStateService.publish).toHaveBeenCalledWith(TEST_NODE_ID);
  });

  it('records the start in the event log against the deployment', async () => {
    await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_STARTED,
      expect.anything(),
      expect.objectContaining({
        actorType: EventPartyType.USER,
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${TEST_DEPLOYMENT_ID}`,
      })
    );
  });

  it('records the reason the start fired, so the log says which rule brought the instance up', async () => {
    await instanceService.bringUp(TEST_DEPLOYMENT_ID, {
      actorId: null,
      reason: InstanceChangeReason.ALWAYS_POLICY,
      note: ' to keep it resident',
    });

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_STARTED,
      expect.anything(),
      expect.objectContaining({
        message: expect.stringContaining('to keep it resident') as string,
        detail: expect.objectContaining({ reason: InstanceChangeReason.ALWAYS_POLICY }) as unknown,
      })
    );
  });

  it('records what the start was sized on', async () => {
    instanceAdmissionService.admit.mockResolvedValue({
      problem: null,
      expected: {
        known: true,
        bytes: 6 * GIB,
        source: ExpectedUsageSource.DECLARED,
        hostWeightsBytes: 0,
        hostResidentBytes: 0,
      },
    });

    await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_STARTED,
      expect.anything(),
      expect.objectContaining({
        detail: expect.objectContaining({
          expectedBytes: 6 * GIB,
          sizedBy: ExpectedUsageSource.DECLARED,
        }) as unknown,
      })
    );
  });

  it('names no actor where the loop acted rather than a user', async () => {
    await instanceService.bringUp(TEST_DEPLOYMENT_ID, { actorId: null, reason: InstanceChangeReason.ALWAYS_POLICY });

    const [, , options] = eventService.recordEvent.mock.calls[0] as [unknown, unknown, Record<string, unknown>];

    expect(options.actorType).toBeUndefined();
    expect(options.actorId).toBeUndefined();
  });

  it('refuses a start while the deployment is disabled', async () => {
    deploymentService.findWithThrow.mockResolvedValue(buildDeployment({ enabled: false }));

    await expect(instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).rejects.toThrow(/disabled/);
    expect(instanceRepository.insert).not.toHaveBeenCalled();
  });

  it('records nothing where the placement is refused', async () => {
    instanceLaunchService.resolvePlacements.mockRejectedValue(new Error('no devices are pinned'));

    await expect(instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).rejects.toThrow();
    expect(instanceRepository.insert).not.toHaveBeenCalled();
  });

  it("drops what failed before a start by hand, since a failed row counts as its node's share", async () => {
    const failed = buildInstance({ instanceState: InstanceState.FAILED });

    instanceRepository.find.mockResolvedValueOnce([failed]).mockResolvedValue([]);

    const outcome = await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(instanceRepository.delete).toHaveBeenCalledWith({ id: failed.id });
    expect(outcome.started).toHaveLength(1);
  });

  it('keeps the run of failed starts where a start by hand started nothing', async () => {
    instanceLaunchService.resolvePlacements.mockRejectedValue(new Error('no devices are pinned'));

    await expect(instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).rejects.toThrow();
    expect(deploymentService.clearLaunchFailures).not.toHaveBeenCalled();
  });

  it('announces a change against the deployments whose instances it touched', async () => {
    const changes = vi.fn();

    instanceService.instanceChanges().subscribe(changes);

    await instanceService.takeDown([buildInstance()], { actorId: null, reason: InstanceChangeReason.IDLE_TIMEOUT });

    expect(changes).toHaveBeenCalledWith([TEST_DEPLOYMENT_ID]);
  });

  it('drops the row and republishes, which is what removes the container', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance()]);

    await instanceService.stop(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(instanceRepository.delete).toHaveBeenCalledWith({ id: 5 });
    expect(instanceDesiredStateService.publish).toHaveBeenCalledWith(TEST_NODE_ID);
  });

  it('publishes once per node, however many of the rows sat on it', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance(), buildInstance()]);

    await instanceService.stop(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(instanceRepository.delete).toHaveBeenCalledTimes(2);
    expect(instanceDesiredStateService.publish).toHaveBeenCalledExactlyOnceWith(TEST_NODE_ID);
  });

  it('records the stop in the event log', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance()]);

    await instanceService.stop(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_STOPPED,
      expect.anything(),
      expect.objectContaining({ actorType: EventPartyType.USER, subjectType: EventPartyType.DEPLOYMENT })
    );
  });

  it('drops the rows the loop hands it, whatever put them there', async () => {
    await instanceService.takeDown([buildInstance()], {
      actorId: null,
      reason: InstanceChangeReason.IDLE_TIMEOUT,
      note: ' after 15m idle',
    });

    expect(instanceRepository.delete).toHaveBeenCalledWith({ id: 5 });
  });

  it('keeps a stopped instance counted in the ledger until its container goes', async () => {
    const instance = buildInstance();

    await instanceService.takeDown([instance], { actorId: null, reason: InstanceChangeReason.IDLE_TIMEOUT });

    expect(vramLedgerService.markStopping).toHaveBeenCalledWith([instance.instanceKey]);
  });

  it("carries a failed instance's last output into its stop event", async () => {
    await instanceService.takeDown([buildInstance({ message: 'CUDA error: out of memory' })], {
      actorId: null,
      reason: InstanceChangeReason.LAUNCH_OVERRAN,
    });

    expect(eventService.recordEvent).toHaveBeenCalledWith(
      EventType.INSTANCE_STOPPED,
      expect.anything(),
      expect.objectContaining({
        detail: expect.objectContaining({ output: 'CUDA error: out of memory' }) as unknown,
      })
    );
  });

  it('records no second stop for a row another path already dropped', async () => {
    instanceRepository.delete.mockResolvedValue({ affected: 0 });

    await instanceService.takeDown([buildInstance()], { actorId: null, reason: InstanceChangeReason.LAUNCH_OVERRAN });

    expect(eventService.recordEvent).not.toHaveBeenCalled();
  });

  it('marks an instance stopping before its row goes, so a later failure cannot strand its prediction', async () => {
    instanceRepository.delete.mockResolvedValueOnce({ affected: 1 }).mockRejectedValueOnce(new Error('lost'));

    await expect(
      instanceService.takeDown([buildInstance(), buildInstance({ id: 6, instanceKey: 'second' })], {
        actorId: null,
        reason: InstanceChangeReason.IDLE_TIMEOUT,
      })
    ).rejects.toThrow('lost');

    expect(vramLedgerService.markStopping).toHaveBeenCalledWith([TEST_INSTANCE_KEY]);
  });

  it('refuses a stop where the deployment holds no rows', async () => {
    await expect(instanceService.stop(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID)).rejects.toThrow(
      'This deployment has no running instances to stop'
    );
  });

  it('announces a start, so an open screen refetches without a reload', async () => {
    const changed = firstValueFrom(instanceService.instancesChanged());

    await instanceService.start(TEST_DEPLOYMENT_ID, TEST_ACTOR_ID);

    await expect(changed).resolves.toBeUndefined();
  });

  it('previews the placement a start would take', async () => {
    await expect(instanceService.previewPlacements(TEST_DEPLOYMENT_ID)).resolves.toEqual({
      placements: [{ nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null }],
      replicas: 1,
      problem: null,
    });
  });

  it('names the constraint a start would break rather than raising it', async () => {
    instanceLaunchService.resolvePlacements.mockRejectedValue(new BadRequestException('no devices are pinned'));

    await expect(instanceService.previewPlacements(TEST_DEPLOYMENT_ID)).resolves.toEqual({
      placements: [],
      replicas: 1,
      problem: 'no devices are pinned',
    });
  });

  it('previews whether a node short of an instance has room for it', async () => {
    instanceAdmissionService.preview.mockResolvedValue({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

    const preview = await instanceService.previewPlacements(TEST_DEPLOYMENT_ID);

    expect(preview.placements).toEqual([expect.objectContaining({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE })]);
  });

  it('asks no room of a node already holding its replicas, whose own instance holds the memory', async () => {
    instanceRepository.find.mockResolvedValue([buildInstance()]);

    await instanceService.previewPlacements(TEST_DEPLOYMENT_ID);

    expect(instanceAdmissionService.preview).not.toHaveBeenCalled();
  });

  it('still names what a node already holding its replicas is expected to take', async () => {
    const expected = {
      known: true,
      bytes: 12 * GIB,
      source: ExpectedUsageSource.ESTIMATED,
      hostWeightsBytes: 0,
      hostResidentBytes: 0,
    };

    instanceRepository.find.mockResolvedValue([buildInstance()]);
    instanceAdmissionService.expectedFor.mockResolvedValue(expected);

    const preview = await instanceService.previewPlacements(TEST_DEPLOYMENT_ID);

    expect(preview.placements).toEqual([expect.objectContaining({ problem: null, expected })]);
  });

  describe('previewDraft', () => {
    const draft = {
      modelId: 1,
      presetId: null,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ALWAYS,
      document: '',
    };

    it('previews a draft the way a start would take it, without reading a saved deployment', async () => {
      instanceAdmissionService.preview.mockResolvedValue({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE });

      const preview = await instanceService.previewDraft(draft, null);

      expect(deploymentService.draft).toHaveBeenCalledWith(draft);
      expect(deploymentService.findWithThrow).not.toHaveBeenCalled();
      expect(preview.placements).toEqual([
        expect.objectContaining({ problem: TOO_LARGE_PROBLEM, capacity: TOO_LARGE }),
      ]);
    });

    it('puts every node of a new deployment to the ledger, since none holds an instance of it', async () => {
      instanceRepository.find.mockResolvedValue([buildInstance()]);

      await instanceService.previewDraft(draft, null);

      expect(instanceRepository.find).not.toHaveBeenCalled();
      expect(instanceAdmissionService.preview).toHaveBeenCalledOnce();
    });

    it('asks no room of a node where the deployment being edited already holds its replicas', async () => {
      instanceRepository.find.mockResolvedValue([buildInstance()]);

      await instanceService.previewDraft(draft, TEST_DEPLOYMENT_ID);

      expect(instanceAdmissionService.preview).not.toHaveBeenCalled();
    });

    it('answers a document refused field by field with one sentence, not the exception name', async () => {
      deploymentService.draft.mockRejectedValue(new BadRequestException([{ path: ['contextSize'], message: 'bad' }]));

      const preview = await instanceService.previewDraft(draft, null);

      expect(preview.problem).toBe(
        'This configuration holds a value its backend will not accept, so it cannot be sized'
      );
    });

    it('answers a draft the form cannot yet save with its problem rather than refusing', async () => {
      deploymentService.draft.mockRejectedValue(new BadRequestException('Choose a backend'));

      await expect(instanceService.previewDraft(draft, null)).resolves.toEqual({
        placements: [],
        replicas: 0,
        problem: 'Choose a backend',
      });
    });
  });
});
