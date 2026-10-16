import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'node:util';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { AgentModelInventory, ModelEntry, ModelTask, ModelType, SafetensorsMetadata } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Availability } from './entities/availability.entity';
import { Model } from './entities/model.entity';

import { EventService } from '../event/event.service';
import { NodeService } from '../node/node.service';

const TYPE_NOUNS: Record<ModelType, string> = {
  [ModelType.MODEL]: 'model',
  [ModelType.PROJECTOR]: 'multimodal projector',
  [ModelType.LORA]: 'LoRA adapter',
  [ModelType.CONTROL_VECTOR]: 'control vector',
};

interface IHeldModel {
  availability: Availability;
  model: Model;
}

@Injectable()
export class ModelCatalogueService {
  private readonly logger = new Logger(ModelCatalogueService.name);

  constructor(
    private readonly eventService: EventService,
    private readonly nodeService: NodeService,
    @InjectRepository(Model) private readonly modelRepository: Repository<Model>,
    @InjectRepository(Availability) private readonly availabilityRepository: Repository<Availability>
  ) {}

  /**
   * Merges a node's whole report into the fleet catalogue: a fingerprint already known gains an
   * availability entry rather than a second model, and one the report omits loses its entry.
   */
  @Transactional()
  async mergeInventory(nodeId: number, inventory: AgentModelInventory, confirmedDate = new Date()): Promise<void> {
    const held = await this.findHeldByFingerprint(nodeId);
    const reported = new Map(inventory.models.map(entry => [entry.fingerprint, entry]));

    let added = 0;

    for (const [fingerprint, entry] of reported) {
      const holding = held.get(fingerprint);

      if (holding !== undefined) {
        held.delete(fingerprint);

        await this.availabilityRepository.update(
          { id: holding.availability.id },
          { path: entry.path, lastConfirmedDate: confirmedDate }
        );

        await this.refreshModel(holding.model, entry);

        continue;
      }

      await this.addAvailability(nodeId, entry, confirmedDate);
      added++;
    }

    const dropped = [...held.values()];

    if (dropped.length > 0) {
      await this.dropAvailability(nodeId, dropped);
    }

    if (added > 0 || dropped.length > 0) {
      this.logger.log(
        { nodeId, added, removed: dropped.length },
        'mergeInventory(): A node changed the models it holds'
      );
    }
  }

  /** Keyed by fingerprint, which is one-to-one with the model a node's entry points at. */
  private async findHeldByFingerprint(nodeId: number): Promise<Map<string, IHeldModel>> {
    const held = await this.availabilityRepository.find({ where: { nodeId } });

    if (held.length === 0) {
      return new Map();
    }

    const models = await this.modelRepository.find({
      where: { id: In(held.map(availability => availability.modelId)) },
    });
    const modelsById = new Map(models.map(model => [model.id, model]));

    const byFingerprint = new Map<string, IHeldModel>();

    for (const availability of held) {
      const model = modelsById.get(availability.modelId);

      if (model !== undefined) {
        byFingerprint.set(model.fingerprint, { availability, model });
      }
    }

    return byFingerprint;
  }

  private async addAvailability(nodeId: number, entry: ModelEntry, confirmedDate: Date): Promise<void> {
    const model = await this.findOrCreateModel(nodeId, entry);

    await this.availabilityRepository.insert(
      new Availability({ modelId: model.id, nodeId, path: entry.path, lastConfirmedDate: confirmedDate })
    );
  }

  private async findOrCreateModel(nodeId: number, entry: ModelEntry): Promise<Model> {
    const known = await this.modelRepository.findOne({ where: { fingerprint: entry.fingerprint } });

    if (known !== null) {
      await this.refreshModel(known, entry);

      return known;
    }

    const model = new Model({
      fingerprint: entry.fingerprint,
      format: entry.format,
      type: entry.type ?? ModelType.MODEL,
      detectedTasks: this.reportedTasks(entry),
      licence: entry.licence ?? null,
      modalities: entry.modalities ?? null,
      sizeBytes: entry.sizeBytes,
      shardCount: entry.shardCount,
      name: entry.name,
      ggufMetadata: entry.ggufMetadata,
      safetensorsMetadata: entry.safetensorsMetadata,
    });
    await this.modelRepository.insert(model);

    const nodeName = await this.getNodeName(nodeId);

    await this.eventService.recordEvent(EventType.MODEL_DISCOVERED, EventSeverity.INFO, {
      actorType: EventPartyType.NODE,
      actorId: `${nodeId}`,
      subjectType: EventPartyType.MODEL,
      subjectId: `${model.id}`,
      message: `Node **${nodeName}** reported a new ${TYPE_NOUNS[model.type]} **${model.name}**`,
      detail: {
        name: model.name,
        fingerprint: model.fingerprint,
        format: model.format,
        type: model.type,
        sizeBytes: model.sizeBytes,
        path: entry.path,
      },
    });

    return model;
  }

  /**
   * Mutates `model`. A field a report leaves out, states null or reports no tasks for keeps the row's value, so an
   * older agent or a node missing the model card cannot undo a newer read. Never touches an admin's assigned tasks.
   */
  private async refreshModel(model: Model, entry: ModelEntry): Promise<void> {
    const reportedTasks = this.reportedTasks(entry);

    // An agent predating task sets reads fewer tasks, so it fills an empty set but never narrows one.
    const keepsTasks = reportedTasks.length === 0 || (entry.tasks === undefined && model.detectedTasks.length > 0);

    const read = {
      type: entry.type ?? model.type,
      detectedTasks: keepsTasks ? model.detectedTasks : reportedTasks,
      licence: entry.licence ?? model.licence,
      modalities: entry.modalities ?? model.modalities,
      sizeBytes: entry.sizeBytes,
      ggufMetadata: entry.ggufMetadata,
      safetensorsMetadata: this.reportedSafetensorsMetadata(model, entry),
    };

    const held = {
      type: model.type,
      detectedTasks: model.detectedTasks,
      licence: model.licence,
      modalities: model.modalities,
      sizeBytes: model.sizeBytes,
      ggufMetadata: model.ggufMetadata,
      safetensorsMetadata: model.safetensorsMetadata,
    };

    if (isDeepStrictEqual(held, read)) {
      return;
    }

    await this.modelRepository.update({ id: model.id }, read);

    Object.assign(model, read);

    this.logger.log(
      { modelId: model.id, fingerprint: model.fingerprint, type: model.type, detectedTasks: model.detectedTasks },
      'refreshModel(): A node read a file differently to what the catalogue held'
    );
  }

  private reportedSafetensorsMetadata(model: Model, entry: ModelEntry): SafetensorsMetadata | null {
    const reported = entry.safetensorsMetadata;
    const architecture = reported?.architecture ?? model.safetensorsMetadata?.architecture ?? null;

    return reported === null || architecture === null ? reported : { ...reported, architecture };
  }

  private reportedTasks(entry: ModelEntry): ModelTask[] {
    const reported = entry.tasks ?? (entry.task === undefined || entry.task === null ? [] : [entry.task]);

    return [...new Set(reported)];
  }

  private async dropAvailability(nodeId: number, dropped: IHeldModel[]): Promise<void> {
    await this.availabilityRepository.delete({ id: In(dropped.map(holding => holding.availability.id)) });

    const nodeName = await this.getNodeName(nodeId);

    // The scanned name, never the display name: an operator chasing this is looking at a disk.
    for (const holding of dropped) {
      await this.eventService.recordEvent(EventType.MODEL_AVAILABILITY_REMOVED, EventSeverity.WARNING, {
        actorType: EventPartyType.NODE,
        actorId: `${nodeId}`,
        subjectType: EventPartyType.MODEL,
        subjectId: `${holding.model.id}`,
        message: `Node **${nodeName}** no longer holds model **${holding.model.name}**`,
        detail: {
          name: holding.model.name,
          fingerprint: holding.model.fingerprint,
          path: holding.availability.path,
        },
      });
    }
  }

  private async getNodeName(nodeId: number): Promise<string> {
    const names = await this.nodeService.findNames([nodeId]);

    return names.get(nodeId) ?? `${nodeId}`;
  }
}
