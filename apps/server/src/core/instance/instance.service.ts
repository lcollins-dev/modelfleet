import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject, map } from 'rxjs';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { v7 as uuidv7 } from 'uuid';

import { InstanceState } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType, InstanceChangeReason } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Node } from '../node/entities/node.entity';
import { Instance } from './entities/instance.entity';

import { DeploymentService, IDeploymentDraft } from '../deployment/deployment.service';
import { EventService } from '../event/event.service';
import { VramLedgerService } from '../ledger/vram-ledger.service';
import { NodeService } from '../node/node.service';
import { InstanceAdmissionService } from './instance-admission.service';
import { InstanceDesiredStateService } from './instance-desired-state.service';
import { INodePlacement, InstanceLaunchService } from './instance-launch.service';

const NOTHING_RUNNING_MESSAGE = 'This deployment has no running instances to stop';
const INVALID_DRAFT_MESSAGE = 'This configuration holds a value its backend will not accept, so it cannot be sized';
const DEPLOYMENT_DISABLED_MESSAGE = 'This deployment is disabled. Enable it before starting an instance';
const REPLACING_FAILED_NOTE = ' because its container failed';

/** Nothing raises this until a scheduler retargets a running instance. */
const FIRST_REVISION = 1;

export interface IPlacementPreview {
  placements: INodePlacement[];

  /** How many instances each named node should hold. */
  replicas: number;

  /** The constraint that stops the deployment as a whole, rather than one of its nodes. */
  problem: string | null;
}

export interface IStartOutcome {
  started: Instance[];

  /** The nodes a start passed over, each carrying the constraint it broke. */
  refused: INodePlacement[];
}

export interface IInstanceChange {
  /** Null where the deployment supervisor acted rather than a user. */
  actorId: number | null;

  reason: InstanceChangeReason;

  /** Closes the event message, such as `after 15m idle`. */
  note?: string;
}

@Injectable()
export class InstanceService {
  /** Carries the deployments whose instances the write touched. */
  private readonly instanceChanged = new Subject<number[]>();

  /** The start in progress for each deployment, which the next one for it waits behind. */
  private readonly bringingUp = new Map<number, Promise<IStartOutcome>>();

  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly eventService: EventService,
    private readonly nodeService: NodeService,
    private readonly vramLedgerService: VramLedgerService,
    private readonly instanceAdmissionService: InstanceAdmissionService,
    private readonly instanceDesiredStateService: InstanceDesiredStateService,
    private readonly instanceLaunchService: InstanceLaunchService,
    @InjectRepository(Instance) private readonly instanceRepository: Repository<Instance>
  ) {}

  /** Fires on every write to an instance row, including a node's report of one, so open screens refetch. */
  instancesChanged(): Observable<void> {
    return this.instanceChanged.pipe(map(() => undefined));
  }

  /** Each write to an instance row, a node's report included, as the deployments it touched. */
  instanceChanges(): Observable<number[]> {
    return this.instanceChanged.asObservable();
  }

  announceChanged(deploymentIds: number[]): void {
    this.instanceChanged.next(deploymentIds);
  }

  /**
   * Records each refusal for capacity, since only a start by hand has no loop of its own to say it. Drops what failed
   * first, since a failed row counts as its node's share, and holds to no backoff: an operator pressing start is the
   * retry. A start that starts something clears the run of failed starts, so the deployment is no longer given up on.
   */
  async start(deploymentId: number, actorId: number): Promise<IStartOutcome> {
    const change: IInstanceChange = { actorId, reason: InstanceChangeReason.BY_HAND };

    if (!(await this.deploymentService.findWithThrow(deploymentId)).enabled) {
      throw new BadRequestException(DEPLOYMENT_DISABLED_MESSAGE);
    }

    const failed = (await this.findByDeploymentId(deploymentId)).filter(
      instance => instance.instanceState === InstanceState.FAILED
    );

    await this.takeDown(failed, { actorId, reason: InstanceChangeReason.INSTANCE_FAILED, note: REPLACING_FAILED_NOTE });

    const outcome = await this.bringUp(deploymentId, change);

    if (outcome.started.length > 0) {
      await this.deploymentService.clearLaunchFailures(deploymentId);
    }

    await this.recordCapacityRefusals(deploymentId, outcome.refused, change);

    return outcome;
  }

  /**
   * Brings the deployment up to the placement its document declares, creating only the instances a node is short of
   * and passing over the nodes that cannot take one. Starts for one deployment run one after another, since the
   * supervisor and a start by hand may each ask at once, and two counting a node short would both fill it.
   */
  async bringUp(deploymentId: number, change: IInstanceChange): Promise<IStartOutcome> {
    const previous = this.bringingUp.get(deploymentId);
    const current = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.bringUpNow(deploymentId, change));

    this.bringingUp.set(deploymentId, current);

    try {
      return await current;
    } finally {
      if (this.bringingUp.get(deploymentId) === current) {
        this.bringingUp.delete(deploymentId);
      }
    }
  }

  /** Publishes after the rows are committed, so a rolled-back write cannot leave a container the server forgot. */
  private async bringUpNow(deploymentId: number, change: IInstanceChange): Promise<IStartOutcome> {
    const admitted: string[] = [];
    let outcome: IStartOutcome;

    try {
      outcome = await this.record(deploymentId, change, admitted);
    } catch (error: unknown) {
      for (const instanceKey of admitted) {
        this.vramLedgerService.release(instanceKey);
      }

      throw error;
    }

    for (const nodeId of new Set(outcome.started.map(instance => instance.nodeId))) {
      await this.instanceDesiredStateService.publish(nodeId);
    }

    if (outcome.started.length > 0) {
      this.announceChanged([deploymentId]);
    }

    return outcome;
  }

  /** An `always` deployment stopped here is brought up again by the deployment supervisor. */
  async stop(deploymentId: number, actorId: number): Promise<void> {
    const instances = await this.findByDeploymentId(deploymentId);

    if (instances.length === 0) {
      throw new BadRequestException(NOTHING_RUNNING_MESSAGE);
    }

    await this.takeDown(instances, { actorId, reason: InstanceChangeReason.BY_HAND });
  }

  /**
   * Drops the rows, which removes their containers. Needs each instance's deployment and node relations for the
   * event it records. A publish that fails after a row has gone leaves that container running until the node's set
   * is next built.
   */
  async takeDown(instances: Instance[], change: IInstanceChange): Promise<void> {
    if (instances.length === 0) {
      return;
    }

    for (const instance of instances) {
      // Marked first, so a row gone before a later drop fails still has its memory released once its container goes.
      this.vramLedgerService.markStopping([instance.instanceKey]);

      await this.drop(instance, change);
    }

    for (const nodeId of new Set(instances.map(instance => instance.nodeId))) {
      await this.instanceDesiredStateService.publish(nodeId);
    }

    this.announceChanged([...new Set(instances.map(instance => instance.deploymentId))]);
  }

  /** Answers what a start would do without writing anything, so the screen names its nodes before it is used. */
  async previewPlacements(deploymentId: number): Promise<IPlacementPreview> {
    const deployment = await this.deploymentService.findWithThrow(deploymentId);

    return this.previewFor(deployment, await this.countByNode(deploymentId));
  }

  /**
   * As `previewPlacements`, for a deployment as a form holds it before it is saved. `deploymentId` names the saved
   * deployment being edited, whose running instances hold their nodes' share. A draft the form cannot yet save
   * answers with its problem rather than refusing, since the form asks while it is being typed.
   */
  async previewDraft(draft: IDeploymentDraft, deploymentId: number | null): Promise<IPlacementPreview> {
    let deployment: Deployment;

    try {
      deployment = await this.deploymentService.draft(draft);
    } catch (error: unknown) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      return { placements: [], replicas: 0, problem: this.draftProblemOf(error) };
    }

    const held = deploymentId === null ? new Map<number, number>() : await this.countByNode(deploymentId);

    return this.previewFor(deployment, held);
  }

  /** A document refused field by field carries its issues as a list, which the form already shows beside each field. */
  private draftProblemOf(error: BadRequestException): string {
    const response = error.getResponse();
    const listed = typeof response === 'object' && 'message' in response && Array.isArray(response.message);

    return listed ? INVALID_DRAFT_MESSAGE : error.message;
  }

  private async previewFor(deployment: Deployment, held: Map<number, number>): Promise<IPlacementPreview> {
    const replicas = this.instanceLaunchService.replicasOf(deployment);

    try {
      const placements: INodePlacement[] = [];

      for (const placement of await this.instanceLaunchService.resolvePlacements(deployment)) {
        const short = (held.get(placement.nodeId) ?? 0) < replicas;

        placements.push(await this.previewPlacement(deployment, placement, short));
      }

      return { placements, replicas, problem: null };
    } catch (error: unknown) {
      if (!(error instanceof BadRequestException)) {
        throw error;
      }

      return { placements: [], replicas, problem: error.message };
    }
  }

  /** A node already holding its share is not put to the ledger, which would count its own instances against it. */
  private async previewPlacement(
    deployment: Deployment,
    placement: INodePlacement,
    short: boolean
  ): Promise<INodePlacement> {
    if (placement.problem !== null) {
      return placement;
    }

    if (short) {
      return { ...placement, ...(await this.instanceAdmissionService.preview(deployment, placement)) };
    }

    const expected = await this.instanceAdmissionService.expectedFor(deployment, placement);

    return expected === null ? placement : { ...placement, expected };
  }

  /** Oldest first, since the keys of one deployment's instances sort by the order they were issued in. */
  findByDeploymentId(deploymentId: number): Promise<Instance[]> {
    return this.instanceRepository.find({
      where: { deploymentId },
      relations: { deployment: { preset: true }, node: true },
      order: { instanceKey: 'ASC' },
    });
  }

  findInDeployment(deploymentId: number, instanceKey: string): Promise<Instance | null> {
    return this.instanceRepository.findOne({
      where: { deploymentId, instanceKey },
      relations: { deployment: true, node: true },
    });
  }

  /** The columns routing reads, with no relation loaded, since it runs on every inference request. */
  findForRouting(deploymentId: number): Promise<Instance[]> {
    return this.instanceRepository.find({
      select: ['id', 'instanceKey', 'nodeId', 'instanceState', 'configurationRevision'],
      where: { deploymentId },
      order: { instanceKey: 'ASC' },
    });
  }

  findByNodeId(nodeId: number): Promise<Instance[]> {
    return this.instanceRepository.find({
      where: { nodeId },
      relations: { deployment: { preset: true }, node: true },
      order: { instanceKey: 'ASC' },
    });
  }

  /** Ordered by node name, then by the order each was issued in. */
  findAll(): Promise<Instance[]> {
    return this.instanceRepository.find({
      relations: { deployment: { preset: true }, node: true },
      order: { node: { name: 'ASC' }, instanceKey: 'ASC' },
    });
  }

  /** Pushes each key the ledger admitted onto `admitted`, so a rolled-back write can release them. */
  @Transactional()
  private async record(deploymentId: number, change: IInstanceChange, admitted: string[]): Promise<IStartOutcome> {
    const deployment = await this.deploymentService.findWithThrow(deploymentId);

    if (!deployment.enabled) {
      throw new BadRequestException(DEPLOYMENT_DISABLED_MESSAGE);
    }

    const placements = await this.instanceLaunchService.resolvePlacements(deployment);
    const replicas = this.instanceLaunchService.replicasOf(deployment);
    const held = await this.countByNode(deploymentId);

    const outcome: IStartOutcome = { started: [], refused: [] };

    for (const placement of placements) {
      if (placement.problem !== null) {
        outcome.refused.push(placement);

        continue;
      }

      const node = await this.nodeService.findWithThrow(placement.nodeId);
      const short = replicas - (held.get(placement.nodeId) ?? 0);

      for (let index = 0; index < short; index++) {
        const instanceKey = uuidv7();
        const admission = await this.instanceAdmissionService.admit(deployment, placement, instanceKey);

        if (admission.problem !== null) {
          outcome.refused.push({ ...placement, ...admission });

          break;
        }

        admitted.push(instanceKey);
        outcome.started.push(await this.create(deployment, node, { ...placement, ...admission }, instanceKey, change));
      }
    }

    return outcome;
  }

  private async countByNode(deploymentId: number): Promise<Map<number, number>> {
    const instances = await this.instanceRepository.find({ where: { deploymentId }, select: ['nodeId'] });
    const held = new Map<number, number>();

    for (const instance of instances) {
      held.set(instance.nodeId, (held.get(instance.nodeId) ?? 0) + 1);
    }

    return held;
  }

  private async create(
    deployment: Deployment,
    node: Node,
    placement: INodePlacement,
    instanceKey: string,
    change: IInstanceChange
  ): Promise<Instance> {
    const instance = new Instance({
      instanceKey,
      deploymentId: deployment.id,
      nodeId: placement.nodeId,
      revision: FIRST_REVISION,
      configurationRevision: deployment.configurationRevision,
      pins: placement.pins,
    });

    await this.instanceRepository.insert(instance);

    await this.eventService.recordEvent(EventType.INSTANCE_STARTED, EventSeverity.INFO, {
      ...this.actorOf(change),
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${deployment.id}`,
      message: `Started an instance of **${deployment.name}** on **${node.name}**${change.note ?? ''}`,
      detail: {
        name: deployment.name,
        instanceKey: instance.instanceKey,
        nodeName: node.name,
        devices: placement.pins.gpus.join(', '),
        reason: change.reason,
        ...(placement.expected === undefined
          ? {}
          : { expectedBytes: placement.expected.bytes, sizedBy: placement.expected.source }),
      },
    });

    return instance;
  }

  @Transactional()
  /** Records nothing where another path dropped the row first, so one stop is logged once. */
  private async drop(instance: Instance, change: IInstanceChange): Promise<void> {
    const deleted = await this.instanceRepository.delete({ id: instance.id });

    if (deleted.affected === 0) {
      return;
    }

    const deploymentName = instance.deployment?.name ?? '';
    const nodeName = instance.node?.name ?? '';

    await this.eventService.recordEvent(EventType.INSTANCE_STOPPED, EventSeverity.INFO, {
      ...this.actorOf(change),
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${instance.deploymentId}`,
      message: `Stopped an instance of **${deploymentName}** on **${nodeName}**${change.note ?? ''}`,
      detail: {
        name: deploymentName,
        instanceKey: instance.instanceKey,
        nodeName,
        reason: change.reason,
        ...(instance.message === null ? {} : { output: instance.message }),
      },
    });
  }

  private async recordCapacityRefusals(
    deploymentId: number,
    refused: INodePlacement[],
    change: IInstanceChange
  ): Promise<void> {
    if (refused.every(placement => placement.capacity === undefined)) {
      return;
    }

    const deployment = await this.deploymentService.findWithThrow(deploymentId);

    for (const placement of refused) {
      if (placement.capacity === undefined) {
        continue;
      }

      const node = await this.nodeService.findWithThrow(placement.nodeId);

      await this.eventService.recordEvent(EventType.INSTANCE_START_REFUSED, EventSeverity.WARNING, {
        ...this.actorOf(change),
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${deployment.id}`,
        message: `Could not start an instance of **${deployment.name}** on **${node.name}**`,
        detail: {
          name: deployment.name,
          problem: placement.problem ?? '',
          nodeName: node.name,
          ...this.instanceAdmissionService.capacityDetail(placement.capacity),
        },
      });
    }
  }

  /** An event the deployment supervisor records carries no actor, the way the rest of the system's own actions do. */
  private actorOf(change: IInstanceChange): { actorType?: EventPartyType; actorId?: string } {
    return change.actorId === null ? {} : { actorType: EventPartyType.USER, actorId: `${change.actorId}` };
  }
}
