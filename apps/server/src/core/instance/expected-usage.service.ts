import { Injectable } from '@nestjs/common';

import { GIB, IInstancePins } from '@libs/backends';
import {
  backendFor,
  EstimateBasis,
  EstimateInputSource,
  IEstimatedCompanion,
  IMissingEstimateInput,
  IVramEstimate,
  IVramEstimateInput,
} from '@libs/backends/runtime';
import { ExpectedUsageSource } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { GpuService } from '../gpu/gpu.service';
import { ModelReferenceService } from '../model/model-reference.service';
import { InstanceLaunchService } from './instance-launch.service';
import { MeasuredVramService } from './measured-vram.service';

import { DECLARED_VRAM_KEY, IDocumentHalves, splitByOwner } from '../configuration/schema/fleet';

export interface IKnownUsage {
  known: true;
  bytes: number;
  source: ExpectedUsageSource;

  /** Weights kept off the GPUs, which `bytes` leaves out. */
  hostWeightsBytes: number;

  /** The share of them system memory must hold, which counts nothing for a table read from a mapped file. */
  hostResidentBytes: number;

  cardShares: number[] | null;
}

export interface IUnknownUsage {
  known: false;
  missing: IMissingEstimateInput[];
}

export type IExpectedUsage = IKnownUsage | IUnknownUsage;

interface ISizing {
  deployment: Deployment;
  pins: IInstancePins;
  halves: IDocumentHalves;
  estimate: IVramEstimate;
  cardShares: number[] | null;
}

type UsageSource = (sizing: ISizing) => Promise<IKnownUsage | null>;

@Injectable()
export class ExpectedUsageService {
  /**
   * In trust order, and the first to know a figure answers. A configured estimate is what the backend allocates, and an
   * operator's declared figure may reflect a change a measurement has not seen.
   */
  private readonly sources: UsageSource[] = [
    sizing => this.estimated(sizing, [EstimateBasis.CONFIGURATION], ExpectedUsageSource.CONFIGURED),
    sizing => this.declared(sizing),
    sizing => this.measured(sizing),
    sizing => this.estimated(sizing, [EstimateBasis.METADATA, EstimateBasis.WEIGHTS], ExpectedUsageSource.ESTIMATED),
  ];

  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly gpuService: GpuService,
    private readonly instanceLaunchService: InstanceLaunchService,
    private readonly measuredVramService: MeasuredVramService,
    private readonly modelReferenceService: ModelReferenceService
  ) {}

  /** Needs the deployment's model and preset relations loaded. */
  async expectedFor(deployment: Deployment, nodeId: number, pins: IInstancePins): Promise<IExpectedUsage> {
    const halves = splitByOwner(this.deploymentService.resolveConfiguration(deployment).configuration);
    const estimateInput = await this.estimateInputFor(deployment, nodeId, pins, halves);
    const { estimate, cardShares } = backendFor(this.deploymentService.getBackend(deployment)).sizeVram(estimateInput);
    const sizing = { deployment, pins, halves, estimate, cardShares };
    const missing = sizing.estimate.computed ? [] : [...sizing.estimate.missing];
    const missingDevices = missing.filter(input => input.source === EstimateInputSource.DEVICE);

    if (missingDevices.length > 0) {
      return { known: false, missing: missingDevices };
    }

    for (const source of this.sources) {
      const usage = await source(sizing);

      if (usage !== null) {
        return usage;
      }
    }

    return { known: false, missing };
  }

  private estimated(sizing: ISizing, bases: EstimateBasis[], source: ExpectedUsageSource): Promise<IKnownUsage | null> {
    const estimate = sizing.estimate;

    if (!estimate.computed || !bases.includes(estimate.basis)) {
      return Promise.resolve(null);
    }

    return Promise.resolve({
      known: true,
      bytes: estimate.totalBytes,
      source,
      hostWeightsBytes: estimate.hostWeightsBytes,
      hostResidentBytes: estimate.hostResidentBytes,
      cardShares: sizing.cardShares,
    });
  }

  private async measured(sizing: ISizing): Promise<IKnownUsage | null> {
    const bytes = await this.measuredVramService.rememberedFor(sizing.deployment.configurationRevision, sizing.pins);

    return bytes === null ? null : this.withEstimatedHost(sizing, bytes, ExpectedUsageSource.MEASURED);
  }

  private declared(sizing: ISizing): Promise<IKnownUsage | null> {
    const gib = sizing.halves.fleet[DECLARED_VRAM_KEY];

    if (typeof gib !== 'number' || gib <= 0) {
      return Promise.resolve(null);
    }

    return Promise.resolve(this.withEstimatedHost(sizing, Math.round(gib * GIB), ExpectedUsageSource.DECLARED));
  }

  private withEstimatedHost(sizing: ISizing, bytes: number, source: ExpectedUsageSource): IKnownUsage {
    const estimate = sizing.estimate;

    return {
      known: true,
      bytes,
      source,
      hostWeightsBytes: estimate.computed ? estimate.hostWeightsBytes : 0,
      hostResidentBytes: estimate.computed ? estimate.hostResidentBytes : 0,
      cardShares: sizing.cardShares,
    };
  }

  private async estimateInputFor(
    deployment: Deployment,
    nodeId: number,
    pins: IInstancePins,
    halves: IDocumentHalves
  ): Promise<IVramEstimateInput> {
    const gpus = await this.gpuService.findByNodeId(nodeId);
    const totals = new Map(gpus.map(gpu => [gpu.deviceKey, gpu.memoryTotalBytes]));

    return {
      model: {
        ...this.instanceLaunchService.describeModel(deployment),
        tensors: deployment.model?.ggufMetadata?.tensors ?? null,
      },
      companions: await this.companionsOf(deployment, halves),
      configuration: halves.backend,
      deviceCount: pins.gpus.length,
      devices: pins.gpus.map(deviceKey => ({ deviceKey, totalBytes: totals.get(deviceKey) ?? null })),
    };
  }

  private async companionsOf(deployment: Deployment, halves: IDocumentHalves): Promise<IEstimatedCompanion[]> {
    const references = await this.modelReferenceService.resolve(
      this.deploymentService.getBackend(deployment),
      halves.backend
    );

    return references.flatMap(reference =>
      reference.model === undefined ? [] : [{ field: reference.field, sizeBytes: reference.model.sizeBytes }]
    );
  }
}
