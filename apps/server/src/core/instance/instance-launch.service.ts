import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

import { CompanionPath, DesiredInstance, DesiredModel, ModelType } from '@libs/agent-protocol';
import {
  BackendId,
  definitionFor,
  IInstancePins,
  imageVariantOf,
  pinsRefusal,
  PinsRefusal,
  resolveImage,
} from '@libs/backends';
import { ConfigurationDocument, NodeState } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';
import { Instance } from './entities/instance.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { GpuService } from '../gpu/gpu.service';
import { IFitReport } from '../ledger/vram-ledger.service';
import { ModelReferenceService } from '../model/model-reference.service';
import { ModelService } from '../model/model.service';
import { NodeService } from '../node/node.service';
import { IKnownUsage } from './expected-usage.service';

import { IFleetPlacement, placementSchema, splitByOwner } from '../configuration/schema/fleet';
import { modelReferenceProblem, IResolvedModelReference, modelTypeLabel } from '../model/model-reference';
import { servableProblem, stagesProblem } from '../model/servable';

const NO_PLACEMENT_MESSAGE = "Choose one node's CPU or one or more GPUs";
const NODE_GONE_MESSAGE = 'This deployment is assigned to a node that no longer exists';
const UNKNOWN_DEVICE_MESSAGE = 'This deployment is assigned to a device that the node has not reported';
const MODEL_MISSING_MESSAGE = 'The model used by this deployment is not stored on this node';
const COMPANION_MISSING_MESSAGE = 'This node does not hold';
const IMAGE_MISSING_MESSAGE = 'Set a container image. This backend has no default image for';
const PINS_REFUSAL_MESSAGES: Record<PinsRefusal, string> = {
  [PinsRefusal.SEVERAL_DEVICES]: 'This backend supports only one GPU. Select one GPU on this node',
  [PinsRefusal.CPU_BESIDE_DEVICES]: "This backend cannot offload to RAM. Select either this node's CPU or its GPUs",
};

const NODE_UNAVAILABLE_MESSAGES: Record<Exclude<NodeState, NodeState.ONLINE>, string> = {
  [NodeState.REGISTERED]: 'The agent on this node has not connected yet',
  [NodeState.OFFLINE]: 'This node is offline',
  [NodeState.DISABLED]: 'This node is disabled',
};

const DEFAULT_REPLICAS = 1;

interface IPlacementProblem {
  problem: string | null;
  modelMissing?: boolean;
}

interface IResolvedFiles extends IPlacementProblem {
  weightsPath: string | null;
  companionPaths: CompanionPath[];
}

export interface INodePlacement extends IPlacementProblem {
  nodeId: number;
  pins: IInstancePins;

  /** Present where the ledger refused the node, and on every node a preview put to it. */
  capacity?: IFitReport;

  /** Filled by a preview, where the node takes a card and the deployment can be sized. */
  expected?: IKnownUsage;

  evictions?: IPlannedEviction[];
}

/** One instance a plan would stop to make room for a start. */
export interface IPlannedEviction {
  instance: Instance;

  idleMs: number;

  releasedBytes: number;
}

@Injectable()
export class InstanceLaunchService {
  private readonly logger = new Logger(InstanceLaunchService.name);

  constructor(
    private readonly modelReferenceService: ModelReferenceService,
    private readonly deploymentService: DeploymentService,
    private readonly gpuService: GpuService,
    private readonly modelService: ModelService,
    private readonly nodeService: NodeService
  ) {}

  /**
   * Chooses nothing. A node that cannot take an instance carries the constraint it broke rather than refusing the
   * others, so only a document naming no node at all throws.
   */
  async resolvePlacements(deployment: Deployment): Promise<INodePlacement[]> {
    const placement = this.readPlacement(deployment);
    const backend = this.deploymentService.getBackend(deployment);
    const configuration = splitByOwner(this.deploymentService.resolveConfiguration(deployment).configuration).backend;
    const onCpu = new Set(placement.nodeIds ?? []);
    const byNode = this.groupByNode(placement);

    if (byNode.size === 0) {
      throw new BadRequestException(NO_PLACEMENT_MESSAGE);
    }

    const placements: INodePlacement[] = [];

    for (const [nodeId, devices] of [...byNode].sort(([left], [right]) => left - right)) {
      const pins = { cpu: onCpu.has(nodeId), gpus: devices };

      const image = this.readImage(backend, configuration, pins);

      placements.push({ nodeId, pins, ...(await this.problemWith(deployment, nodeId, pins, image)) });
    }

    return placements;
  }

  /** Per node the placement names, rather than across the fleet. */
  replicasOf(deployment: Deployment): number {
    const replicas = this.deploymentService.resolveConfiguration(deployment).configuration.replicas;

    return typeof replicas === 'number' && replicas > 0 ? replicas : DEFAULT_REPLICAS;
  }

  /** A node's pins all go to one instance, since an instance takes the whole set it is given. */
  private groupByNode(placement: IFleetPlacement): Map<number, string[]> {
    const byNode = new Map<number, string[]>();

    for (const nodeId of placement.nodeIds ?? []) {
      byNode.set(nodeId, []);
    }

    for (const gpu of placement.gpus ?? []) {
      byNode.set(gpu.nodeId, [...(byNode.get(gpu.nodeId) ?? []), gpu.deviceKey]);
    }

    return byNode;
  }

  private async problemWith(
    deployment: Deployment,
    nodeId: number,
    pins: IInstancePins,
    image: string | null
  ): Promise<IPlacementProblem> {
    const unavailable = await this.nodeUnavailable(nodeId);

    if (unavailable !== null) {
      return { problem: unavailable };
    }

    const unknown = await this.unknownDevices(nodeId, pins.gpus);

    if (unknown.length > 0) {
      return { problem: `${UNKNOWN_DEVICE_MESSAGE}: ${unknown.join(', ')}` };
    }

    const refusal = pinsRefusal(definitionFor(this.deploymentService.getBackend(deployment)).container, pins);

    if (refusal !== null) {
      return { problem: PINS_REFUSAL_MESSAGES[refusal] };
    }

    if (image === null) {
      return { problem: `${IMAGE_MISSING_MESSAGE} ${imageVariantOf(pins)} placements` };
    }

    const files = await this.resolveFiles(deployment, nodeId);

    if (files.weightsPath === null) {
      return { problem: files.problem, modelMissing: files.modelMissing };
    }

    const notServable = this.notServable(deployment);

    return notServable === null
      ? { problem: files.problem, modelMissing: files.modelMissing }
      : { problem: notServable };
  }

  /**
   * Reports only what a node does or does not hold: anything a launch raises here drops the instance from desired
   * state, which removes a container that may be serving.
   */
  private async resolveFiles(deployment: Deployment, nodeId: number): Promise<IResolvedFiles> {
    const weightsPath = await this.pathOn(deployment.modelId, nodeId);

    if (weightsPath === null) {
      return { problem: MODEL_MISSING_MESSAGE, modelMissing: true, weightsPath, companionPaths: [] };
    }

    const companionPaths: CompanionPath[] = [];

    for (const reference of await this.readCompanions(deployment)) {
      const problem = modelReferenceProblem(reference);

      if (problem !== null) {
        return { problem, weightsPath, companionPaths };
      }

      const model = reference.model;

      if (model === undefined) {
        this.logger.error({ field: reference.field }, 'resolveFiles(): A reference passed its check without a row');

        throw new InternalServerErrorException();
      }

      const path = await this.pathOn(model.id, nodeId);

      if (path === null) {
        return { problem: this.companionMissingMessage(model), modelMissing: true, weightsPath, companionPaths };
      }

      companionPaths.push({ field: reference.field, path });
    }

    return { problem: null, weightsPath, companionPaths };
  }

  private async pathOn(modelId: number, nodeId: number): Promise<string | null> {
    return (await this.modelService.findAvailability(modelId, nodeId))?.path ?? null;
  }

  private notServable(deployment: Deployment): string | null {
    const model = deployment.model;

    if (model === undefined) {
      this.logger.error({ deploymentId: deployment.id }, 'notServable(): A deployment was read without its model');

      throw new InternalServerErrorException();
    }

    return servableProblem(model) ?? stagesProblem(model, this.deploymentService.getBackend(deployment));
  }

  /** Needs the deployment's preset and model relations loaded. The node looks nothing up beyond what this carries. */
  async describe(instance: Instance, deployment: Deployment): Promise<DesiredInstance> {
    const halves = splitByOwner(this.deploymentService.resolveConfiguration(deployment).configuration);
    const backend = this.deploymentService.getBackend(deployment);
    const files = await this.filesOrThrow(deployment, instance.nodeId);

    return {
      instanceKey: instance.instanceKey,
      revision: instance.revision,
      backend,
      servedModel: deployment.name,
      model: this.describeModel(deployment),
      weightsPath: files.weightsPath,
      companionPaths: files.companionPaths.length > 0 ? files.companionPaths : undefined,
      configuration: halves.backend,
      pins: instance.pins,
      image: this.readImage(backend, halves.backend, instance.pins),
    };
  }

  /** Needs the deployment's model relation loaded. */
  describeModel(deployment: Deployment): DesiredModel {
    const model = deployment.model;

    if (model === undefined) {
      this.logger.error({ deploymentId: deployment.id }, 'describeModel(): A deployment was read without its model');

      throw new InternalServerErrorException();
    }

    return {
      sizeBytes: model.sizeBytes,
      architecture: model.architecture,
      quantisation: model.ggufMetadata?.quantisation ?? null,
      layerCount: model.ggufMetadata?.layerCount ?? null,
      embeddingLength: model.ggufMetadata?.embeddingLength ?? null,
      headCount: model.ggufMetadata?.headCount ?? null,
      headCountKv: model.ggufMetadata?.headCountKv ?? null,
      contextLength: model.ggufMetadata?.contextLength ?? null,
    };
  }

  private readPlacement(deployment: Deployment): IFleetPlacement {
    const configuration = this.deploymentService.resolveConfiguration(deployment).configuration;
    const parsed = placementSchema.safeParse(configuration.placement ?? {});

    return parsed.success ? parsed.data : {};
  }

  private readImage(backend: BackendId, configuration: ConfigurationDocument, pins: IInstancePins): string | null {
    return resolveImage(definitionFor(backend), configuration, pins);
  }

  /** A node the agent is not connected to would hold the row and create nothing, so the start says so instead. */
  private async nodeUnavailable(nodeId: number): Promise<string | null> {
    const node = await this.nodeService.find(nodeId);

    if (node === null) {
      return NODE_GONE_MESSAGE;
    }

    const state = this.nodeService.getState(node);

    return state === NodeState.ONLINE ? null : NODE_UNAVAILABLE_MESSAGES[state];
  }

  private async unknownDevices(nodeId: number, devices: string[]): Promise<string[]> {
    if (devices.length === 0) {
      return [];
    }

    const reported = new Set((await this.gpuService.findByNodeId(nodeId)).map(gpu => gpu.deviceKey));

    return devices.filter(deviceKey => !reported.has(deviceKey));
  }

  /** Takes the scanned name, never the display name: an operator chasing this is looking at a disk. */
  private companionMissingMessage(model: { name: string; type: ModelType }): string {
    return `${COMPANION_MISSING_MESSAGE} ${model.name}, the ${modelTypeLabel(model.type)} this deployment uses`;
  }

  private readCompanions(deployment: Deployment): Promise<IResolvedModelReference[]> {
    const halves = splitByOwner(this.deploymentService.resolveConfiguration(deployment).configuration);

    return this.modelReferenceService.resolve(this.deploymentService.getBackend(deployment), halves.backend);
  }

  /** Placement reports all of this per node; a start racing a scan meets it here instead. */
  private async filesOrThrow(
    deployment: Deployment,
    nodeId: number
  ): Promise<{ weightsPath: string; companionPaths: CompanionPath[] }> {
    const resolved = await this.resolveFiles(deployment, nodeId);

    if (resolved.problem !== null || resolved.weightsPath === null) {
      throw new BadRequestException(resolved.problem ?? MODEL_MISSING_MESSAGE);
    }

    return { weightsPath: resolved.weightsPath, companionPaths: resolved.companionPaths };
  }
}
