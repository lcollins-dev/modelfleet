import { Injectable } from '@nestjs/common';

import {
  CreatePresetRequestDto,
  CreatePresetResponseDto,
  ListPresetDto,
  PresetDto,
  PresetImpactRequestDto,
  PresetImpactResponseDto,
  PresetListRequestDto,
  PresetListResponseDto,
  UpdatePresetRequestDto,
} from '@libs/dto';

import { Preset } from '@/core/preset/entities/preset.entity';

import { ConfigService } from '@/config/config.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { PresetService } from '@/core/preset/preset.service';

@Injectable()
export class PresetAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly deploymentService: DeploymentService,
    private readonly presetService: PresetService
  ) {}

  async getPresetList(presetListRequest: PresetListRequestDto, page: number): Promise<PresetListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [presets, total] = await this.presetService.findAndCount(
      { search: presetListRequest.search, backend: presetListRequest.backend },
      pageSize * (page - 1),
      pageSize
    );

    const deployments = await this.deploymentService.countByPreset(presets.map(preset => preset.id));

    return {
      presetList: presets.map(preset => this.getIListPreset(preset, deployments.get(preset.id) ?? 0)),
      pages: Math.ceil(total / pageSize),
    };
  }

  async getPreset(presetId: number): Promise<PresetDto> {
    const preset = await this.presetService.findWithThrow(presetId);
    const deployments = await this.deploymentService.countByPreset([preset.id]);

    return {
      ...this.getIListPreset(preset, deployments.get(preset.id) ?? 0),
      schemaVersion: preset.schemaVersion,
      document: preset.document,
      configuration: preset.configuration,
      updatedDate: preset.updatedDate,
    };
  }

  async getPresetImpact(
    presetId: number,
    presetImpactRequest: PresetImpactRequestDto
  ): Promise<PresetImpactResponseDto> {
    const impact = await this.deploymentService.findPresetImpact(presetId, presetImpactRequest.document);

    return {
      deployments: impact.deployments,
      affectedDeployments: impact.affectedDeployments,
      changedFields: impact.changedFields.map(field => ({
        key: field.key,
        inheritingDeployments: field.inheritingDeployments,
      })),
    };
  }

  async createPreset(createPresetRequest: CreatePresetRequestDto, actorId: number): Promise<CreatePresetResponseDto> {
    const preset = await this.presetService.create(
      {
        name: createPresetRequest.name,
        description: createPresetRequest.description ?? '',
        backend: createPresetRequest.backend,
        document: createPresetRequest.document,
      },
      actorId
    );

    return { id: preset.id };
  }

  updatePreset(presetId: number, updatePresetRequest: UpdatePresetRequestDto, actorId: number): Promise<void> {
    return this.presetService.update(
      presetId,
      {
        name: updatePresetRequest.name,
        description: updatePresetRequest.description,
        document: updatePresetRequest.document,
      },
      actorId
    );
  }

  deletePreset(presetId: number, actorId: number): Promise<void> {
    return this.presetService.remove(presetId, actorId);
  }

  private getIListPreset(preset: Preset, deployments: number): ListPresetDto {
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      backend: preset.backend,
      deployments,
      createdDate: preset.createdDate,
    };
  }
}
