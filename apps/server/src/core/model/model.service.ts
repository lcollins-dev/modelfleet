import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'node:util';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { ModelFormat, ModelTask, ModelType, ServerMessageType } from '@libs/agent-protocol';
import { EventPartyType, EventSeverity, EventType, ModelState } from '@libs/dto';

import { Availability } from './entities/availability.entity';
import { Model } from './entities/model.entity';

import { AgentConnectionService } from '../agent/agent-connection.service';
import { EventService } from '../event/event.service';
import { NodeService } from '../node/node.service';

import { ModelUsageRegistry } from './model-usage.registry';

const MODEL_MISSING_MESSAGE = 'This model does not exist';

export interface IModelCriteria {
  search?: string;
  state?: ModelState[];
  type?: ModelType[];

  /** A null matches the models whose tasks are unknown. */
  task?: (ModelTask | null)[];

  format?: ModelFormat[];
}

export interface IModelChanges {
  displayName?: string;

  /** Empty returns the model to the tasks the scans read. */
  tasks?: ModelTask[];
}

@Injectable()
export class ModelService {
  constructor(
    private readonly agentConnectionService: AgentConnectionService,
    private readonly eventService: EventService,
    private readonly modelUsageRegistry: ModelUsageRegistry,
    private readonly nodeService: NodeService,
    @InjectRepository(Model) private readonly modelRepository: Repository<Model>,
    @InjectRepository(Availability) private readonly availabilityRepository: Repository<Availability>
  ) {}

  /** Ordered by label, each model carrying the availability entries that say which nodes hold it. */
  findAndCount(criteria: IModelCriteria, skip: number, take: number): Promise<[Model[], number]> {
    const queryBuilder = this.modelRepository
      .createQueryBuilder('model')
      .leftJoinAndSelect('model.availability', 'availability')
      .leftJoinAndSelect('availability.node', 'node');

    if (criteria.search !== undefined) {
      this.narrowToSearch(queryBuilder, criteria.search);
    }

    if (criteria.state !== undefined) {
      this.narrowToStates(queryBuilder, criteria.state);
    }

    if (criteria.type !== undefined && criteria.type.length > 0) {
      queryBuilder.andWhere('model.type IN (:...types)', { types: criteria.type });
    }

    if (criteria.task !== undefined && criteria.task.length > 0) {
      this.narrowToTasks(queryBuilder, criteria.task);
    }

    if (criteria.format !== undefined && criteria.format.length > 0) {
      queryBuilder.andWhere('model.format IN (:...formats)', { formats: criteria.format });
    }

    return queryBuilder
      .addSelect('COALESCE(model.displayName, model.name)', 'model_label')
      .orderBy('model_label', 'ASC')
      .addOrderBy('model.id', 'ASC')
      .take(take)
      .skip(skip)
      .getManyAndCount();
  }

  async findWithThrow(modelId: number): Promise<Model> {
    const model = await this.modelRepository.findOne({
      where: { id: modelId },
      relations: { availability: { node: true } },
    });

    if (!model) {
      throw new BadRequestException(MODEL_MISSING_MESSAGE);
    }

    return model;
  }

  /** What one node holds, ordered by path, each entry carrying the model it points at. */
  findAvailabilityByNode(nodeId: number): Promise<Availability[]> {
    return this.availabilityRepository.find({
      where: { nodeId },
      relations: { model: true },
      order: { path: 'ASC' },
    });
  }

  findAvailability(modelId: number, nodeId: number): Promise<Availability | null> {
    return this.availabilityRepository.findOne({ where: { modelId, nodeId } });
  }

  /** Asks a node to sweep the directories it is configured with. Dropped where the node holds no session. */
  requestScan(nodeId: number): void {
    this.agentConnectionService.send(nodeId, ServerMessageType.SCAN_MODELS, {});
  }

  /** A fingerprint that matches nothing is absent from the map, not an error. */
  async findByFingerprints(fingerprints: string[]): Promise<Map<string, Model>> {
    if (fingerprints.length === 0) {
      return new Map();
    }

    const models = await this.modelRepository.find({ where: { fingerprint: In(fingerprints) } });

    return new Map(models.map(model => [model.fingerprint, model]));
  }

  /** A model that no longer exists is absent from the map, not an error. */
  async findNames(modelIds: number[]): Promise<Map<number, string>> {
    if (modelIds.length === 0) {
      return new Map();
    }

    const models = await this.modelRepository.find({
      select: ['id', 'name', 'displayName'],
      where: { id: In(modelIds) },
    });

    return new Map(models.map(model => [model.id, model.label]));
  }

  @Transactional()
  async update(modelId: number, changes: IModelChanges, actorId: number): Promise<void> {
    const model = await this.modelRepository.findOneBy({ id: modelId });

    if (!model) {
      throw new BadRequestException(MODEL_MISSING_MESSAGE);
    }

    if (changes.displayName !== undefined) {
      await this.rename(model, changes.displayName, actorId);
    }

    if (changes.tasks !== undefined) {
      await this.assignTasks(model, changes.tasks, actorId);
    }
  }

  /** Refused while anything registered with `ModelUsageRegistry` still points at the model. */
  @Transactional()
  async remove(modelId: number, actorId: number): Promise<void> {
    const model = await this.findWithThrow(modelId);
    const references = await this.modelUsageRegistry.findUsage(model.id);

    if (references.length > 0) {
      const held = references.map(reference => `${reference.kind} "${reference.name}"`).join(', ');

      throw new BadRequestException(`This model is in use by ${held}`);
    }

    await this.modelRepository.delete({ id: model.id });

    await this.eventService.recordEvent(EventType.MODEL_DELETED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.MODEL,
      subjectId: `${model.id}`,
      message: `Deleted model **${model.label}**`,
      detail: { name: model.label, fingerprint: model.fingerprint },
    });
  }

  private async rename(model: Model, displayName: string, actorId: number): Promise<void> {
    displayName = displayName.trim();

    const previousLabel = model.label;

    model.displayName = displayName.length > 0 && displayName !== model.name ? displayName : null;

    if (model.label === previousLabel) {
      return;
    }

    await this.modelRepository.update({ id: model.id }, { displayName: model.displayName });

    await this.eventService.recordEvent(EventType.MODEL_RENAMED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.MODEL,
      subjectId: `${model.id}`,
      message: `Renamed model **${previousLabel}** to **${model.label}**`,
      detail: { name: model.label, previousName: previousLabel, fingerprint: model.fingerprint },
    });
  }

  private async assignTasks(model: Model, tasks: ModelTask[], actorId: number): Promise<void> {
    const previousTasks = model.tasks;
    const previousAssigned = model.assignedTasks;
    const assigned = this.inTaskOrder(tasks);

    model.assignedTasks =
      assigned.length > 0 && !isDeepStrictEqual(assigned, this.inTaskOrder(model.detectedTasks)) ? assigned : null;

    if (isDeepStrictEqual(model.assignedTasks, previousAssigned)) {
      return;
    }

    await this.modelRepository.update({ id: model.id }, { assignedTasks: model.assignedTasks });

    if (isDeepStrictEqual(this.inTaskOrder(model.tasks), this.inTaskOrder(previousTasks))) {
      return;
    }

    const listed = model.tasks.length > 0 ? model.tasks.join(', ') : 'unknown';
    const message =
      model.assignedTasks === null
        ? `Returned model **${model.label}** to the tasks its scans read: ${listed}`
        : `Set the tasks of model **${model.label}** to ${listed}`;

    await this.eventService.recordEvent(EventType.MODEL_TASKS_CHANGED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.MODEL,
      subjectId: `${model.id}`,
      message,
      detail: {
        name: model.label,
        fingerprint: model.fingerprint,
        tasks: model.tasks.join(','),
        previousTasks: previousTasks.join(','),
        assigned: model.assignedTasks !== null,
      },
    });
  }

  private inTaskOrder(tasks: readonly ModelTask[]): ModelTask[] {
    return Object.values(ModelTask).filter(task => tasks.includes(task));
  }

  /** The file name is matched in a subquery so the joined availability keeps every node's row. */
  private narrowToSearch(queryBuilder: SelectQueryBuilder<Model>, search: string): void {
    const heldAsNamed = `
      SELECT 1 FROM "availability" "named"
      WHERE "named"."modelId" = "model"."id"
        AND LOWER(regexp_replace("named"."path", '^.*/', '')) LIKE LOWER(:search)
    `;

    queryBuilder.andWhere(
      new Brackets(where => {
        where
          .where('LOWER(model.name) LIKE LOWER(:search)')
          .orWhere('LOWER(model.displayName) LIKE LOWER(:search)')
          .orWhere('LOWER(model.fingerprint) LIKE LOWER(:search)')
          .orWhere(`EXISTS (${heldAsNamed})`);
      }),
      { search: `%${search}%` }
    );
  }

  /** Each condition mirrors the state the API reads off the same rows: held by an online node, or not. */
  private narrowToStates(queryBuilder: SelectQueryBuilder<Model>, states: ModelState[]): void {
    const heldOnline = `
      SELECT 1 FROM "availability" "held"
      INNER JOIN "node" "holder" ON "holder"."id" = "held"."nodeId"
      WHERE "held"."modelId" = "model"."id" AND "holder"."enabled" = true AND "holder"."lastSeenDate" > :cutoff
    `;

    const conditions: Record<ModelState, string> = {
      [ModelState.AVAILABLE]: `EXISTS (${heldOnline})`,
      [ModelState.UNAVAILABLE]: `NOT EXISTS (${heldOnline})`,
    };

    queryBuilder.andWhere(
      new Brackets(where => {
        for (const state of states) {
          where.orWhere(`(${conditions[state]})`);
        }
      }),
      { cutoff: this.nodeService.getOfflineCutoff() }
    );
  }

  private narrowToTasks(queryBuilder: SelectQueryBuilder<Model>, tasks: (ModelTask | null)[]): void {
    const held = 'COALESCE(model.assignedTasks, model.detectedTasks)';
    const stated = tasks.filter(task => task !== null);

    queryBuilder.andWhere(
      new Brackets(where => {
        if (stated.length > 0) {
          where.orWhere(`${held} && ARRAY[:...tasks]::varchar[]`, { tasks: stated });
        }

        if (tasks.includes(null)) {
          where.orWhere(`cardinality(${held}) = 0`);
        }
      })
    );
  }
}
