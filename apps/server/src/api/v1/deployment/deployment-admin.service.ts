import { Injectable } from '@nestjs/common';

import {
  ApplyDeploymentsResponseDto,
  CreateDeploymentRequestDto,
  CreateDeploymentResponseDto,
  DeploymentDto,
  DeploymentConfigurationDto,
  DeploymentListRequestDto,
  DeploymentListResponseDto,
  ListDeploymentDto,
  OutOfDateDeploymentsResponseDto,
  PresetSwapRequestDto,
  PresetSwapResponseDto,
  UpdateDeploymentRequestDto,
} from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { ConfigService } from '@/config/config.service';
import { DeploymentService } from '@/core/deployment/deployment.service';

import { getIModelLicence } from '../model/model-description';

@Injectable()
export class DeploymentAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly deploymentService: DeploymentService
  ) {}

  async getDeploymentList(
    deploymentListRequest: DeploymentListRequestDto,
    page: number
  ): Promise<DeploymentListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [deployments, total] = await this.deploymentService.findAndCount(
      { search: deploymentListRequest.search },
      pageSize * (page - 1),
      pageSize
    );

    return {
      deploymentList: deployments.map(deployment => this.getIListDeployment(deployment)),
      pages: Math.ceil(total / pageSize),
      total,
    };
  }

  async getDeployment(deploymentId: number): Promise<DeploymentDto> {
    const deployment = await this.deploymentService.findWithThrow(deploymentId);

    return {
      ...this.getIListDeployment(deployment),
      description: deployment.description,
      schemaVersion: deployment.schemaVersion,
      document: deployment.document,
      overrides: deployment.configuration,
      updatedDate: deployment.updatedDate,
    };
  }

  async getDeploymentConfiguration(deploymentId: number): Promise<DeploymentConfigurationDto> {
    const deployment = await this.deploymentService.findWithThrow(deploymentId);
    const effective = this.deploymentService.resolveConfiguration(deployment);

    return {
      backend: effective.backend,
      entries: effective.entries,
      configuration: effective.configuration,
      presetId: deployment.presetId,
      presetName: deployment.preset?.name ?? null,
    };
  }

  updateState(deploymentId: number, enabled: boolean, actorId: number): Promise<void> {
    return this.deploymentService.setEnabled(deploymentId, enabled, actorId);
  }

  async getOutOfDateDeployments(): Promise<OutOfDateDeploymentsResponseDto> {
    return { outOfDate: await this.deploymentService.countOutOfDate() };
  }

  applyDeployment(deploymentId: number, actorId: number): Promise<void> {
    return this.deploymentService.apply(deploymentId, actorId);
  }

  async applyDeployments(actorId: number): Promise<ApplyDeploymentsResponseDto> {
    return { applied: await this.deploymentService.applyAll(actorId) };
  }

  async previewPresetSwap(
    deploymentId: number,
    presetSwapRequest: PresetSwapRequestDto
  ): Promise<PresetSwapResponseDto> {
    const preview = await this.deploymentService.previewPresetSwap(deploymentId, {
      presetId: presetSwapRequest.presetId ?? null,
      backend: presetSwapRequest.backend ?? null,
      document: presetSwapRequest.document,
    });

    return { backend: preview.backend, presetName: preview.presetName, droppedKeys: preview.droppedKeys };
  }

  async createDeployment(
    createDeploymentRequest: CreateDeploymentRequestDto,
    actorId: number
  ): Promise<CreateDeploymentResponseDto> {
    const deployment = await this.deploymentService.create(
      {
        name: createDeploymentRequest.name,
        modelId: createDeploymentRequest.modelId,
        presetId: createDeploymentRequest.presetId ?? null,
        backend: createDeploymentRequest.backend ?? null,
        activationPolicy: createDeploymentRequest.activationPolicy,
        description: createDeploymentRequest.description ?? '',
        document: createDeploymentRequest.document,
      },
      actorId
    );

    return { id: deployment.id };
  }

  updateDeployment(
    deploymentId: number,
    updateDeploymentRequest: UpdateDeploymentRequestDto,
    actorId: number
  ): Promise<void> {
    return this.deploymentService.update(
      deploymentId,
      {
        name: updateDeploymentRequest.name,
        modelId: updateDeploymentRequest.modelId,
        presetId: updateDeploymentRequest.presetId ?? null,
        backend: updateDeploymentRequest.backend ?? null,
        activationPolicy: updateDeploymentRequest.activationPolicy,
        description: updateDeploymentRequest.description,
        document: updateDeploymentRequest.document,
      },
      actorId
    );
  }

  deleteDeployment(deploymentId: number, actorId: number): Promise<void> {
    return this.deploymentService.remove(deploymentId, actorId);
  }

  private getIListDeployment(deployment: Deployment): ListDeploymentDto {
    return {
      id: deployment.id,
      name: deployment.name,
      modelId: deployment.modelId,
      modelName: deployment.model?.label ?? '',
      modelLicence: getIModelLicence(deployment.model?.licence ?? null),
      presetId: deployment.presetId,
      presetName: deployment.preset?.name ?? null,
      backend: this.deploymentService.getBackend(deployment),
      activationPolicy: deployment.activationPolicy,
      enabled: deployment.enabled,
      outOfDate: this.deploymentService.isOutOfDate(deployment),
      createdDate: deployment.createdDate,
    };
  }
}
