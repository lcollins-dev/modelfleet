import { Injectable } from '@nestjs/common';

import { GgufMetadata, SafetensorsMetadata } from '@libs/agent-protocol';
import {
  GgufModelMetadataDto,
  ListModelDto,
  ModelDto,
  ModelAvailabilityDto,
  ModelListRequestDto,
  ModelListResponseDto,
  NodeModelDto,
  NodeModelInventoryResponseDto,
  SafetensorsModelMetadataDto,
  UpdateModelRequestDto,
  ModelState,
  ModelTask,
  ModelTaskFilter,
  NodeState,
  UNKNOWN_MODEL_TASK,
} from '@libs/dto';

import { Availability } from '@/core/model/entities/availability.entity';
import { Model } from '@/core/model/entities/model.entity';

import { ConfigService } from '@/config/config.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';

import { getIModelLicence } from './model-description';

type IModelQuantisation = Pick<ListModelDto, 'quantisation' | 'quantisationMixed'>;

@Injectable()
export class ModelAdminService {
  constructor(
    private readonly configService: ConfigService,
    private readonly modelService: ModelService,
    private readonly nodeService: NodeService
  ) {}

  async getModelList(modelListRequest: ModelListRequestDto, page: number): Promise<ModelListResponseDto> {
    const pageSize = this.configService.pageSize;

    const [models, total] = await this.modelService.findAndCount(
      {
        search: modelListRequest.search,
        state: modelListRequest.state,
        type: modelListRequest.type,
        task: modelListRequest.task?.map(task => this.getTaskCriterion(task)),
        format: modelListRequest.format,
      },
      pageSize * (page - 1),
      pageSize
    );

    return {
      modelList: models.map(model => this.getIListModel(model)),
      pages: Math.ceil(total / pageSize),
    };
  }

  async getModel(modelId: number): Promise<ModelDto> {
    const model = await this.modelService.findWithThrow(modelId);

    return {
      ...this.getIListModel(model),
      ggufMetadata: model.ggufMetadata === null ? null : this.getIGgufModelMetadata(model.ggufMetadata),
      safetensorsMetadata:
        model.safetensorsMetadata === null ? null : this.getISafetensorsModelMetadata(model.safetensorsMetadata),
      modalities: model.modalities,
      detectedTasks: model.detectedTasks,
      tasksAssigned: model.assignedTasks !== null,
      createdDate: model.createdDate,
    };
  }

  updateModel(modelId: number, updateModelRequest: UpdateModelRequestDto, actorId: number): Promise<void> {
    const { displayName, tasks } = updateModelRequest;

    return this.modelService.update(modelId, { displayName, tasks }, actorId);
  }

  deleteModel(modelId: number, actorId: number): Promise<void> {
    return this.modelService.remove(modelId, actorId);
  }

  async getNodeModelInventory(nodeId: number): Promise<NodeModelInventoryResponseDto> {
    await this.nodeService.findWithThrow(nodeId);

    const availability = await this.modelService.findAvailabilityByNode(nodeId);

    availability.sort((left, right) => (left.model?.label ?? '').localeCompare(right.model?.label ?? ''));

    const models: NodeModelDto[] = [];

    for (const entry of availability) {
      if (entry.model === undefined) {
        continue;
      }

      models.push(this.getINodeModel(entry, entry.model));
    }

    return { models };
  }

  async scanNodeModels(nodeId: number): Promise<void> {
    await this.nodeService.findWithThrow(nodeId);

    this.modelService.requestScan(nodeId);
  }

  private getIListModel(model: Model): ListModelDto {
    const availability = this.getIModelAvailability(model);

    return {
      id: model.id,
      fingerprint: model.fingerprint,
      name: model.name,
      displayName: model.displayName,
      format: model.format,
      type: model.type,
      tasks: model.tasks,
      licence: getIModelLicence(model.licence),
      ...this.getQuantisation(model),
      sizeBytes: model.sizeBytes,
      shardCount: model.shardCount,
      state: availability.some(entry => entry.nodeState === NodeState.ONLINE)
        ? ModelState.AVAILABLE
        : ModelState.UNAVAILABLE,
      availability,
    };
  }

  /** Ordered by node name. */
  private getIModelAvailability(model: Model): ModelAvailabilityDto[] {
    const availability: ModelAvailabilityDto[] = [];

    for (const entry of model.availability ?? []) {
      if (entry.node === undefined) {
        continue;
      }

      availability.push({
        nodeId: entry.nodeId,
        nodeName: entry.node.name,
        nodeState: this.nodeService.getState(entry.node),
        path: entry.path,
        lastConfirmedDate: entry.lastConfirmedDate,
      });
    }

    return availability.sort((left, right) => left.nodeName.localeCompare(right.nodeName));
  }

  private getINodeModel(availability: Availability, model: Model): NodeModelDto {
    return {
      id: model.id,
      name: model.name,
      displayName: model.displayName,
      format: model.format,
      type: model.type,
      ...this.getQuantisation(model),
      sizeBytes: model.sizeBytes,
      path: availability.path,
      lastConfirmedDate: availability.lastConfirmedDate,
    };
  }

  /** A null asks for the models whose tasks are unknown. */
  private getTaskCriterion(task: ModelTaskFilter): ModelTask | null {
    return task === UNKNOWN_MODEL_TASK ? null : task;
  }

  private getQuantisation(model: Model): IModelQuantisation {
    return {
      quantisation: model.ggufMetadata?.quantisation ?? model.safetensorsMetadata?.dtype ?? null,
      quantisationMixed: model.ggufMetadata?.quantisationMixed ?? false,
    };
  }

  private getIGgufModelMetadata(metadata: GgufMetadata): GgufModelMetadataDto {
    return {
      architecture: metadata.architecture,
      quantisation: metadata.quantisation,
      quantisationMixed: metadata.quantisationMixed,
      layerCount: metadata.layerCount,
      embeddingLength: metadata.embeddingLength,
      headCount: metadata.headCount,
      headCountKv: metadata.headCountKv,
      contextLength: metadata.contextLength,
    };
  }

  private getISafetensorsModelMetadata(metadata: SafetensorsMetadata): SafetensorsModelMetadataDto {
    return {
      dtype: metadata.dtype,
      tensorCount: metadata.tensorCount,
      parameterCount: metadata.parameterCount,
      architecture: metadata.architecture ?? null,
    };
  }
}
