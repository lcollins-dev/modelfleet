import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import {
  EMPTY,
  Observable,
  auditTime,
  catchError,
  concat,
  concatMap,
  filter,
  from,
  merge,
  of,
  takeUntil,
  tap,
} from 'rxjs';

import {
  ActivationPolicy,
  DeploymentInstancesResponseDto,
  ExpectedUsageDto,
  DeploymentResidencyDto,
  InstanceDeviceDto,
  InstanceListResponseDto,
  InstancePlacementDto,
  ListInstanceDto,
  NodeInstancesResponseDto,
  PlacementCapacityDto,
  PlacementNodeDto,
  PlacementPreviewRequestDto,
  PlacementPreviewResponseDto,
  StartInstanceResponseDto,
} from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';
import { Gpu } from '@/core/gpu/entities/gpu.entity';
import { Instance } from '@/core/instance/entities/instance.entity';

import { DeploymentService } from '@/core/deployment/deployment.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { IKnownUsage } from '@/core/instance/expected-usage.service';
import { InstanceService, IPlacementPreview } from '@/core/instance/instance.service';
import { IFitReport } from '@/core/ledger/vram-ledger.service';
import { NodeStateService } from '@/core/node/node-state.service';
import { NodeService } from '@/core/node/node.service';
import { DeploymentSupervisorService } from '@/core/supervisor/deployment-supervisor.service';
import { SupervisorPolicyService } from '@/core/supervisor/supervisor-policy.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

import { INSTANCE_STATES } from './types/mappings';

/** Short against the cadence nodes report on, five seconds by default. */
const PLACEMENT_TELEMETRY_AUDIT_MS = 1000;

@Injectable()
export class InstanceAdminService {
  private readonly logger = new Logger(InstanceAdminService.name);

  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly gpuService: GpuService,
    private readonly instanceService: InstanceService,
    private readonly nodeService: NodeService,
    private readonly nodeStateService: NodeStateService,
    private readonly deploymentSupervisorService: DeploymentSupervisorService,
    private readonly supervisorPolicyService: SupervisorPolicyService,
    private readonly telemetryService: TelemetryService
  ) {}

  async getDeploymentInstances(deploymentId: number): Promise<DeploymentInstancesResponseDto> {
    const deployment = await this.deploymentService.findWithThrow(deploymentId);

    const instances = await this.instanceService.findByDeploymentId(deploymentId);

    return {
      instances: await this.getIListInstances(instances),
      placement: await this.getIInstancePlacement(
        await this.instanceService.previewPlacements(deploymentId),
        instances
      ),
      residency: this.getIDeploymentResidency(deployment, instances),
    };
  }

  async previewPlacement(request: PlacementPreviewRequestDto): Promise<PlacementPreviewResponseDto> {
    const deploymentId = request.deploymentId ?? null;
    const preview = await this.instanceService.previewDraft(
      {
        modelId: request.modelId,
        presetId: request.presetId ?? null,
        backend: request.backend ?? null,
        activationPolicy: request.activationPolicy,
        document: request.document,
      },
      deploymentId
    );
    const instances = deploymentId === null ? [] : await this.instanceService.findByDeploymentId(deploymentId);

    return { placement: await this.getIInstancePlacement(preview, instances) };
  }

  /**
   * Reads the opening set before returning, so an unknown deployment refuses rather than opening a stream. A
   * deployment deleted while the stream is open completes it, since erroring would have the client reconnect onto
   * an opening read that rejects. A failed read otherwise leaves the stream open for the next.
   *
   * Reads again on any instance write, on an edit, enable or disable of this deployment, and on telemetry from a node
   * its placement refuses. A stop drops its row while the container still holds its memory, so only a later reading
   * shows it freed.
   */
  async watchDeploymentInstances(deploymentId: number): Promise<Observable<DeploymentInstancesResponseDto>> {
    const refusingNodeIds = (response: DeploymentInstancesResponseDto) =>
      new Set(response.placement.nodes.filter(node => node.problem !== null).map(node => node.nodeId));

    const opening = await this.getDeploymentInstances(deploymentId);
    let watchedNodeIds = refusingNodeIds(opening);

    const readings = this.telemetryService.telemetryChanged().pipe(
      filter(nodeId => watchedNodeIds.has(nodeId)),
      auditTime(PLACEMENT_TELEMETRY_AUDIT_MS)
    );
    const edits = this.deploymentService.deploymentChanged().pipe(filter(changedId => changedId === deploymentId));
    const removed = this.deploymentService.deploymentRemoved().pipe(filter(removedId => removedId === deploymentId));

    return concat(
      of(opening),
      merge(this.instanceService.instancesChanged(), edits, readings).pipe(
        concatMap(() =>
          from(this.getDeploymentInstances(deploymentId)).pipe(
            catchError((error: unknown) => {
              this.logger.error({ error, deploymentId }, 'watchDeploymentInstances(): Failed to read the deployment');

              return EMPTY;
            })
          )
        ),
        tap(response => {
          watchedNodeIds = refusingNodeIds(response);
        }),
        takeUntil(removed)
      )
    );
  }

  async getNodeInstances(nodeId: number): Promise<NodeInstancesResponseDto> {
    await this.nodeService.findWithThrow(nodeId);

    return { instances: await this.getIListInstances(await this.instanceService.findByNodeId(nodeId)) };
  }

  /** Reads the opening set before returning, so an unknown node refuses rather than opening a stream. */
  async watchNodeInstances(nodeId: number): Promise<Observable<NodeInstancesResponseDto>> {
    const opening = await this.getNodeInstances(nodeId);

    return concat(
      of(opening),
      this.instanceService.instancesChanged().pipe(
        concatMap(() => this.getNodeInstances(nodeId)),
        catchError(() => EMPTY)
      )
    );
  }

  async getInstances(): Promise<InstanceListResponseDto> {
    return { instances: await this.getIListInstances(await this.instanceService.findAll()) };
  }

  async watchInstances(): Promise<Observable<InstanceListResponseDto>> {
    const opening = await this.getInstances();

    return concat(
      of(opening),
      this.instanceService.instancesChanged().pipe(
        concatMap(() =>
          from(this.getInstances()).pipe(
            catchError((error: unknown) => {
              this.logger.error({ error }, 'watchInstances(): Failed to read the fleet');

              return EMPTY;
            })
          )
        )
      )
    );
  }

  async startDeployment(deploymentId: number, actorId: number): Promise<StartInstanceResponseDto> {
    const outcome = await this.instanceService.start(deploymentId, actorId);

    const refused = [];

    for (const placement of outcome.refused) {
      const node = await this.nodeService.findWithThrow(placement.nodeId);

      refused.push({
        nodeId: node.id,
        nodeName: node.name,
        problem: placement.problem ?? '',
        capacity: await this.getIPlacementCapacity(node.id, placement.capacity),
      });
    }

    return { started: outcome.started.length, refused };
  }

  stopDeployment(deploymentId: number, actorId: number): Promise<void> {
    return this.instanceService.stop(deploymentId, actorId);
  }

  private getIDeploymentResidency(deployment: Deployment, instances: Instance[]): DeploymentResidencyDto {
    const facts = this.deploymentSupervisorService.factsFor(deployment, instances);
    const onDemand = facts.activationPolicy === ActivationPolicy.ON_DEMAND;

    return {
      rule: this.supervisorPolicyService.ruleFor(facts.activationPolicy, facts.enabled),
      idleTimeoutMs: onDemand ? facts.idleTimeoutMs : null,
      lastUsedDate: deployment.lastUsedDate ?? null,
      idleSince: onDemand ? (facts.idleSince ?? null) : null,
      inFlight: facts.inFlight,
      launchFailures: deployment.launchFailures,
      retryDate: !facts.givenUp && this.supervisorPolicyService.backingOff(facts) ? (facts.backoffUntil ?? null) : null,
      givenUp: facts.enabled && facts.givenUp,
      lastLaunchFailure: deployment.lastLaunchFailure,
    };
  }

  private async getIInstancePlacement(
    preview: IPlacementPreview,
    instances: Instance[]
  ): Promise<InstancePlacementDto> {
    const nodes: PlacementNodeDto[] = [];

    // A node that no longer exists carries that as its own problem, so it is named by id rather than refusing the rest.
    for (const placement of preview.placements) {
      const node = await this.nodeService.find(placement.nodeId);

      nodes.push({
        nodeId: placement.nodeId,
        nodeName: node?.name ?? `node ${placement.nodeId}`,
        devices: await this.getIInstanceDevices(placement.nodeId, placement.pins.gpus),
        replicas: preview.replicas,
        running: instances.filter(instance => instance.nodeId === placement.nodeId).length,
        problem: placement.problem,
        expectedUsage: this.getIExpectedUsage(placement.expected),
        capacity: await this.getIPlacementCapacity(placement.nodeId, placement.capacity),
      });
    }

    return { nodes, problem: preview.problem };
  }

  private getIExpectedUsage(expected: IKnownUsage | undefined): ExpectedUsageDto | null {
    if (expected === undefined) {
      return null;
    }

    return {
      bytes: expected.bytes,
      source: expected.source,
      hostWeightsBytes: expected.hostWeightsBytes,
      hostResidentBytes: expected.hostResidentBytes,
    };
  }

  private async getIPlacementCapacity(
    nodeId: number,
    report: IFitReport | undefined
  ): Promise<PlacementCapacityDto | null> {
    if (report === undefined) {
      return null;
    }

    const gpus = await this.gpuService.findByNodeId(nodeId);
    const names = new Map(gpus.map(gpu => [gpu.deviceKey, gpu.name]));

    return {
      expectedBytes: report.expectedBytes,
      availableBytes: report.availableBytes,
      hostFreeBytes: report.hostFreeBytes,
      cards: this.inNodeOrder(report.cards, gpus).map(card => ({
        deviceKey: card.deviceKey,
        name: names.get(card.deviceKey) ?? null,
        totalBytes: card.totalBytes,
        usedBytes: card.usedBytes,
        predictedBytes: card.predictedBytes,
        headroomBytes: card.headroomBytes,
        freeBytes: card.freeBytes,
      })),
      hostWeights:
        report.hostWeights === null
          ? null
          : { neededBytes: report.hostWeights.neededBytes, freeBytes: report.hostWeights.freeBytes },
    };
  }

  private async getIListInstances(instances: Instance[]): Promise<ListInstanceDto[]> {
    const listed: ListInstanceDto[] = [];

    for (const instance of instances) {
      listed.push(await this.getIListInstance(instance));
    }

    return listed;
  }

  private async getIListInstance(instance: Instance): Promise<ListInstanceDto> {
    const deployment = instance.deployment;
    const node = instance.node;

    if (deployment === undefined || node === undefined) {
      this.logger.error(
        { instanceKey: instance.instanceKey },
        'getIListInstance(): An instance was read without its deployment or its node'
      );

      throw new InternalServerErrorException();
    }

    return {
      instanceKey: instance.instanceKey,
      deploymentId: deployment.id,
      deploymentName: deployment.name,
      nodeId: node.id,
      nodeName: node.name,
      nodeState: this.nodeService.getState(node),
      devices: await this.getIInstanceDevices(node.id, instance.pins.gpus),
      state: INSTANCE_STATES[instance.instanceState],
      message: instance.message,
      exitCode: instance.exitCode,
      startedDate: this.getStartedDate(instance),
      reportedDate: instance.reportedDate ?? null,
      createdDate: instance.createdDate,
    };
  }

  /** A device the node has stopped reporting keeps its key, since the instance is still pinned to it. */
  private async getIInstanceDevices(nodeId: number, deviceKeys: string[]): Promise<InstanceDeviceDto[]> {
    if (deviceKeys.length === 0) {
      return [];
    }

    const gpus = await this.gpuService.findByNodeId(nodeId);
    const reported = new Map(gpus.map(gpu => [gpu.deviceKey, gpu.name]));
    const devices = deviceKeys.map(deviceKey => ({ deviceKey, name: reported.get(deviceKey) ?? null }));

    return this.inNodeOrder(devices, gpus);
  }

  /** In the order the node lists its devices, with one it no longer reports last. */
  private inNodeOrder<T extends { deviceKey: string }>(items: T[], gpus: Gpu[]): T[] {
    const positions = new Map(gpus.map((gpu, position) => [gpu.deviceKey, position]));

    return items.toSorted(
      (left, right) => (positions.get(left.deviceKey) ?? gpus.length) - (positions.get(right.deviceKey) ?? gpus.length)
    );
  }

  /** Read back from the node's live report, since the row records what it was told rather than a running clock. */
  private getStartedDate(instance: Instance): Date | null {
    const observed = this.nodeStateService.getObserved(instance.nodeId);

    if (observed === null) {
      return null;
    }

    const report = observed.instances.find(reported => reported.instanceKey === instance.instanceKey);

    if (report === undefined || report.uptimeMs === null) {
      return null;
    }

    return new Date(observed.reportedDate.getTime() - report.uptimeMs);
  }
}
