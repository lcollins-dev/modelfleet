import { Injectable } from '@nestjs/common';

import { BackendId, BackendOperation, OperationDefinition, ProjectorModality, tasksAdmit } from '@libs/backends';
import { backendFor, IBackendMapping } from '@libs/backends/runtime';

import { Deployment } from '../deployment/entities/deployment.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { ModelReferenceService } from '../model/model-reference.service';

export enum ResolutionRefusal {
  UNKNOWN_MODEL = 'unknown-model',
  UNSUPPORTED_OPERATION = 'unsupported-operation',
}

export interface IResolvedDeployment {
  deployment: Deployment;
  backend: BackendId;
  capability: OperationDefinition;
  mapping: IBackendMapping;
}

export interface IResolutionResult {
  resolved: IResolvedDeployment | null;
  refusal: ResolutionRefusal | null;
}

@Injectable()
export class DeploymentResolverService {
  constructor(
    private readonly deploymentService: DeploymentService,
    private readonly modelReferenceService: ModelReferenceService
  ) {}

  async resolve(name: string, operation: BackendOperation): Promise<IResolutionResult> {
    const deployment = await this.deploymentService.findByName(name);

    if (deployment === null) {
      return { resolved: null, refusal: ResolutionRefusal.UNKNOWN_MODEL };
    }

    const resolved = await this.resolveDeployment(deployment, operation);

    if (resolved === null) {
      return { resolved: null, refusal: ResolutionRefusal.UNSUPPORTED_OPERATION };
    }

    return { resolved, refusal: null };
  }

  async findServing(operation: BackendOperation): Promise<IResolvedDeployment[]> {
    const deployments = await this.deploymentService.findAll();
    const resolved = await Promise.all(deployments.map(deployment => this.resolveDeployment(deployment, operation)));

    return resolved.filter(candidate => candidate !== null);
  }

  private async resolveDeployment(
    deployment: Deployment,
    operation: BackendOperation
  ): Promise<IResolvedDeployment | null> {
    const backend = this.deploymentService.getBackend(deployment);
    const resolvedBackend = backendFor(backend);
    const capability = resolvedBackend.definition.operations[operation];

    if (capability === undefined) {
      return null;
    }

    const projectors = await this.projectorModalities(deployment, backend);

    if (!tasksAdmit(deployment.model?.tasks ?? [], operation, projectors)) {
      return null;
    }

    return { deployment, backend, capability, mapping: resolvedBackend.mapping };
  }

  private async projectorModalities(deployment: Deployment, backend: BackendId): Promise<ProjectorModality[]> {
    const references = await this.modelReferenceService.resolve(
      backend,
      this.deploymentService.resolveConfiguration(deployment).configuration
    );

    return references.flatMap(reference => reference.model?.modalities ?? []);
  }
}
