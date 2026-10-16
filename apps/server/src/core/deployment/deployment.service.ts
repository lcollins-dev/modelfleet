import { BadRequestException, Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, Subject } from 'rxjs';
import { Brackets, In, MoreThan, Repository, SelectQueryBuilder } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { z } from 'zod';

import { BackendId, declarationFor, BackendDeclaration, referencesModel } from '@libs/backends';
import { ActivationPolicy, ConfigurationDocument, EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Model } from '../model/entities/model.entity';
import { Preset } from '../preset/entities/preset.entity';
import { Deployment } from './entities/deployment.entity';

import { ConfigurationRevisionService } from '../configuration/configuration-revision.service';
import { ConfigurationService, IStoredConfiguration } from '../configuration/configuration.service';
import {
  EffectiveConfigurationService,
  IEffectiveConfiguration,
} from '../configuration/effective-configuration.service';
import { EventService } from '../event/event.service';
import { ModelReferenceService } from '../model/model-reference.service';
import { ModelService } from '../model/model.service';
import { PresetService } from '../preset/preset.service';

import { IModelUsage, IModelUsageSource, ModelUsageRegistry } from '../model/model-usage.registry';
import { formatProblem, servableProblem, stagesProblem } from '../model/servable';
import { IPresetReference, IPresetReferenceSource, PresetReferenceRegistry } from '../preset/preset-reference.registry';

const DEPLOYMENT_MISSING_MESSAGE = 'This deployment does not exist';
const DEPLOYMENT_NAME_TAKEN_MESSAGE = 'A deployment with this name already exists';
const BACKEND_WITH_PRESET_MESSAGE = 'A deployment that uses a preset must use the backend from that preset';
const BACKEND_MISSING_MESSAGE = 'Choose a backend when the deployment does not use a preset';

const DEPLOYMENT_KIND = 'deployment';

/**
 * The stamp is coarse: a busy deployment would otherwise write on every inference request. `MIN_IDLE_TIMEOUT` in
 * the fleet schema matches it, so no deployment can idle out inside one stamp.
 */
const LAST_USED_STAMP_INTERVAL_MS = 60_000;

/** A failed instance created after the last recorded failure belongs to a start not yet counted. */
const NEW_START = '("lastLaunchFailureDate" IS NULL OR "lastLaunchFailureDate" < :instanceCreatedDate)';

/** What a counting statement returns: one row where it counted a start, none where the start was already counted. */
const COUNTED_ROWS = z.array(z.object({ name: z.string(), launchFailures: z.number() }));

export interface ILaunchFailureCount {
  deploymentId: number;
  name: string;
  launchFailures: number;
  output: string | null;
}

export interface IDeploymentCriteria {
  search?: string;
}

interface IResolvedPreset {
  backend: BackendId;

  /** Empty where the deployment names no preset. */
  name: string;

  /** Empty where the deployment names no preset. */
  configuration: ConfigurationDocument;

  /** Null where the deployment names no preset. */
  row: Preset | null;
}

export interface IDeploymentDraft {
  modelId: number;
  presetId: number | null;
  backend: BackendId | null;
  activationPolicy: ActivationPolicy;
  document: string;
}

export interface IDeploymentDefinition extends IDeploymentDraft {
  name: string;
  description: string;
}

export interface IPresetSwap {
  presetId: number | null;
  backend: BackendId | null;
  document: string;
}

interface IDeploymentFields {
  name: string;
  description: string | null;
  activationPolicy: ActivationPolicy;
  modelId: number;
  presetId: number | null;
  preset: IResolvedPreset;
  stored: IStoredConfiguration;
}

export interface IPresetSwapPreview {
  backend: BackendId;
  presetName: string | null;
  droppedKeys: string[];
}

export interface IInheritedFieldCount {
  key: string;
  inheritingDeployments: number;
}

export interface IPresetChangeImpact {
  deployments: number;
  affectedDeployments: number;
  changedFields: IInheritedFieldCount[];
}

@Injectable()
export class DeploymentService implements OnModuleInit, IModelUsageSource, IPresetReferenceSource {
  private readonly logger = new Logger(DeploymentService.name);

  private readonly removed = new Subject<number>();

  private readonly changed = new Subject<number>();

  private readonly counted = new Subject<ILaunchFailureCount>();

  private readonly lastStamped = new Map<number, number>();

  constructor(
    private readonly modelReferenceService: ModelReferenceService,
    private readonly configurationRevisionService: ConfigurationRevisionService,
    private readonly configurationService: ConfigurationService,
    private readonly effectiveConfigurationService: EffectiveConfigurationService,
    private readonly eventService: EventService,
    private readonly modelService: ModelService,
    private readonly modelUsageRegistry: ModelUsageRegistry,
    private readonly presetService: PresetService,
    private readonly presetReferenceRegistry: PresetReferenceRegistry,
    @InjectRepository(Deployment) private readonly deploymentRepository: Repository<Deployment>
  ) {}

  onModuleInit(): void {
    this.modelUsageRegistry.register(this);
    this.presetReferenceRegistry.register(this);
  }

  /** A deployment holds a model by serving it, and equally by naming its fingerprint in a reference field. */
  async findModelUsage(modelId: number): Promise<IModelUsage[]> {
    const served = await this.findReferences({ modelId });
    const companions = await this.findCompanionUsage(modelId);
    const byName = new Map([...served, ...companions].map(reference => [reference.name, reference]));

    return [...byName.values()];
  }

  findPresetReferences(presetId: number): Promise<IPresetReference[]> {
    return this.findReferences({ presetId });
  }

  /** Runs inside the write that changed the preset, so a deployment inheriting a key it moved reads as out of date. */
  async onPresetConfigurationChanged(presetId: number): Promise<void> {
    const deployments = await this.deploymentRepository.find({ where: { presetId }, relations: { preset: true } });

    for (const deployment of deployments) {
      const revision = this.revisionOf(deployment);

      if (revision !== deployment.configurationRevision) {
        await this.deploymentRepository.update({ id: deployment.id }, { configurationRevision: revision });
      }
    }
  }

  @Transactional()
  async create(definition: IDeploymentDefinition, actorId: number): Promise<Deployment> {
    const name = definition.name.trim();
    const presetId = definition.presetId;
    const preset = await this.resolvePreset(presetId, definition.backend);
    const description = definition.description.trim();

    const model = await this.modelService.findWithThrow(definition.modelId);
    this.checkIsServable(model);
    this.checkFormatIsLoaded(model, preset.backend);
    this.checkStagesAreKnown(model, preset.backend);
    await this.checkNameIsFree(name);

    const stored = this.configurationService.derive(definition.document, preset.backend);
    await this.modelReferenceService.checkIntroduced(
      { backend: preset.backend, configuration: preset.configuration },
      {
        backend: preset.backend,
        configuration: this.effectiveOf(preset.backend, preset.configuration, stored.configuration),
      }
    );

    const deployment = this.assemble({
      name,
      description: description.length > 0 ? description : null,
      activationPolicy: definition.activationPolicy,
      modelId: model.id,
      presetId,
      preset,
      stored,
    });
    await this.deploymentRepository.insert(deployment);

    await this.eventService.recordEvent(EventType.DEPLOYMENT_CREATED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${deployment.id}`,
      message: `Created deployment **${name}** serving model **${model.label}**`,
      detail: { name, backend: preset.backend, modelName: model.label, presetName: preset.name },
    });

    return deployment;
  }

  /**
   * Builds the deployment `draft` describes the way `create` would store it, and writes nothing. It carries its model
   * and preset, and is left unnamed, since nothing that reads a draft reads its name.
   */
  async draft(draft: IDeploymentDraft): Promise<Deployment> {
    const preset = await this.resolvePreset(draft.presetId, draft.backend);
    const model = await this.modelService.findWithThrow(draft.modelId);

    const deployment = this.assemble({
      name: '',
      description: null,
      activationPolicy: draft.activationPolicy,
      modelId: model.id,
      presetId: draft.presetId,
      preset,
      stored: this.configurationService.derive(draft.document, preset.backend),
    });

    deployment.model = model;
    deployment.preset = preset.row ?? undefined;

    return deployment;
  }

  /** Ordered by name, each deployment carrying its model and its preset. */
  findAndCount(criteria: IDeploymentCriteria, skip: number, take: number): Promise<[Deployment[], number]> {
    const queryBuilder = this.deploymentRepository
      .createQueryBuilder('deployment')
      .leftJoinAndSelect('deployment.model', 'model')
      .leftJoinAndSelect('deployment.preset', 'preset');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere(
        new Brackets(where => {
          where
            .where('LOWER(deployment.name) LIKE LOWER(:search)', { search: `%${criteria.search}%` })
            .orWhere('LOWER(deployment.description) LIKE LOWER(:search)', { search: `%${criteria.search}%` });
        })
      );
    }

    // Paging over a join distinguishes rows with SELECT DISTINCT, which Postgres only orders by a selected expression.
    return queryBuilder
      .addSelect('LOWER(deployment.name)', 'deployment_name_lower')
      .orderBy('deployment_name_lower', 'ASC')
      .addOrderBy('deployment.id', 'ASC')
      .take(take)
      .skip(skip)
      .getManyAndCount();
  }

  /** Ordered by name, each deployment carrying its model and its preset. */
  findAll(): Promise<Deployment[]> {
    return this.deploymentRepository
      .createQueryBuilder('deployment')
      .leftJoinAndSelect('deployment.model', 'model')
      .leftJoinAndSelect('deployment.preset', 'preset')
      .addSelect('LOWER(deployment.name)', 'deployment_name_lower')
      .orderBy('deployment_name_lower', 'ASC')
      .addOrderBy('deployment.id', 'ASC')
      .getMany();
  }

  /** Compared without case, the way `name` is unique. */
  findByName(name: string): Promise<Deployment | null> {
    return this.deploymentRepository
      .createQueryBuilder('deployment')
      .leftJoinAndSelect('deployment.model', 'model')
      .leftJoinAndSelect('deployment.preset', 'preset')
      .where('LOWER(deployment.name) = LOWER(:name)', { name })
      .getOne();
  }

  async findWithThrow(deploymentId: number): Promise<Deployment> {
    const deployment = await this.deploymentRepository.findOne({
      where: { id: deploymentId },
      relations: { model: true, preset: true },
    });

    if (!deployment) {
      throw new BadRequestException(DEPLOYMENT_MISSING_MESSAGE);
    }

    return deployment;
  }

  /** Needs the preset relation loaded where the deployment names one. */
  getBackend(deployment: Deployment): BackendId {
    const backend = deployment.preset?.backend ?? deployment.backend;

    if (backend === null) {
      this.logger.error(
        { deploymentId: deployment.id },
        'getBackend(): A deployment holds neither a preset nor a backend of its own'
      );

      throw new InternalServerErrorException();
    }

    return backend;
  }

  /** Needs the preset relation loaded where the deployment names one. */
  resolveConfiguration(deployment: Deployment): IEffectiveConfiguration {
    return this.effectiveConfigurationService.resolve(
      this.getBackend(deployment),
      this.declarationOf(deployment),
      deployment.preset?.configuration ?? {},
      deployment.configuration
    );
  }

  /** Writes nothing, so a swap is confirmed before `update` carries it out. */
  async previewPresetSwap(deploymentId: number, swap: IPresetSwap): Promise<IPresetSwapPreview> {
    const deployment = await this.findWithThrow(deploymentId);
    const target = await this.resolvePreset(swap.presetId, swap.backend);

    return {
      backend: target.backend,
      presetName: swap.presetId === null ? null : target.name,
      droppedKeys: this.orphanedKeys(deployment, swap.document, target.backend),
    };
  }

  /** Validates `document` the way saving it would, so an invalid one is refused rather than counted. */
  async findPresetImpact(presetId: number, document: string): Promise<IPresetChangeImpact> {
    const preset = await this.presetService.findWithThrow(presetId);
    const derived = this.configurationService.derive(document, preset.backend);
    const changedKeys = this.effectiveConfigurationService.changedKeys(preset.configuration, derived.configuration);

    const deployments = await this.deploymentRepository.find({ select: ['id', 'configuration'], where: { presetId } });
    const inherits = (deployment: Deployment, key: string): boolean => !Object.hasOwn(deployment.configuration, key);

    return {
      deployments: deployments.length,
      affectedDeployments: deployments.filter(deployment => changedKeys.some(key => inherits(deployment, key))).length,
      changedFields: changedKeys.map(key => ({
        key,
        inheritingDeployments: deployments.filter(deployment => inherits(deployment, key)).length,
      })),
    };
  }

  /** A preset no deployment names is absent from the map, not a zero. */
  async countByPreset(presetIds: number[]): Promise<Map<number, number>> {
    if (presetIds.length === 0) {
      return new Map();
    }

    const counts = await this.deploymentRepository
      .createQueryBuilder('deployment')
      .select('deployment.presetId', 'presetId')
      .addSelect('COUNT(deployment.id)::int', 'deployments')
      .where('deployment.presetId IN (:...presetIds)', { presetIds })
      .groupBy('deployment.presetId')
      .getRawMany<{ presetId: number; deployments: number }>();

    return new Map(counts.map(count => [count.presetId, count.deployments]));
  }

  /** A deployment that no longer exists is absent from the map, not an error. */
  async findNames(deploymentIds: number[]): Promise<Map<number, string>> {
    if (deploymentIds.length === 0) {
      return new Map();
    }

    const deployments = await this.deploymentRepository.find({
      select: ['id', 'name'],
      where: { id: In(deploymentIds) },
    });

    return new Map(deployments.map(deployment => [deployment.id, deployment.name]));
  }

  /**
   * Records that a request was routed to this deployment, at most once per `LAST_USED_STAMP_INTERVAL_MS`, which is
   * what the deployment supervisor counts idleness from. The interval is held in memory, so a restart stamps once more.
   */
  async stampLastUsed(deploymentId: number): Promise<void> {
    const now = Date.now();
    const stamped = this.lastStamped.get(deploymentId);

    if (stamped !== undefined && now - stamped < LAST_USED_STAMP_INTERVAL_MS) {
      return;
    }

    this.lastStamped.set(deploymentId, now);

    await this.deploymentRepository.update({ id: deploymentId }, { lastUsedDate: new Date(now) });
  }

  /**
   * Counts one failure per start: an instance created before the last failure was recorded belongs to a start already
   * counted, as the other replicas of one failed start do, and moves only the output on. Counting is decided in the one
   * statement, so two nodes reporting at once cannot both count one start. Announces each start it counts.
   */
  async recordLaunchFailure(
    deploymentId: number,
    instanceCreatedDate: Date,
    failedDate: Date,
    output: string | null
  ): Promise<void> {
    const result = await this.deploymentRepository
      .createQueryBuilder()
      .update(Deployment)
      .set({
        launchFailures: () => '"launchFailures" + 1',
        lastLaunchFailureDate: failedDate,
        lastLaunchFailure: output,
      })
      .where('id = :deploymentId', { deploymentId })
      .andWhere(NEW_START, { instanceCreatedDate })
      .returning('"name", "launchFailures"')
      .execute();

    const counted = COUNTED_ROWS.parse(result.raw).at(0);

    // A run cleared since leaves the output cleared with it.
    if (counted === undefined) {
      await this.deploymentRepository.update(
        { id: deploymentId, launchFailures: MoreThan(0) },
        { lastLaunchFailure: output }
      );

      return;
    }

    this.counted.next({ deploymentId, name: counted.name, launchFailures: counted.launchFailures, output });
  }

  /** An instance ready ends the run of failures, so the next failure backs off from the start again. */
  async clearLaunchFailures(deploymentId: number): Promise<void> {
    await this.deploymentRepository.update(
      { id: deploymentId, launchFailures: MoreThan(0) },
      { launchFailures: 0, lastLaunchFailureDate: null, lastLaunchFailure: null }
    );
  }

  /**
   * A disabled deployment is stopped by the deployment supervisor and cannot be started by hand. Announces the change
   * once it is committed.
   */
  async setEnabled(deploymentId: number, enabled: boolean, actorId: number): Promise<void> {
    await this.writeEnabled(deploymentId, enabled, actorId);

    this.changed.next(deploymentId);
  }

  @Transactional()
  private async writeEnabled(deploymentId: number, enabled: boolean, actorId: number): Promise<void> {
    const deployment = await this.findWithThrow(deploymentId);

    await this.deploymentRepository.update({ id: deployment.id }, { enabled });

    await this.eventService.recordEvent(
      enabled ? EventType.DEPLOYMENT_ENABLED : EventType.DEPLOYMENT_DISABLED,
      EventSeverity.INFO,
      {
        actorType: EventPartyType.USER,
        actorId: `${actorId}`,
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${deployment.id}`,
        message: `${enabled ? 'Enabled' : 'Disabled'} deployment **${deployment.name}**`,
        detail: { name: deployment.name },
      }
    );
  }

  isOutOfDate(deployment: Deployment): boolean {
    return deployment.appliedRevision !== deployment.configurationRevision;
  }

  countOutOfDate(): Promise<number> {
    return this.outOfDateQuery().getCount();
  }

  /** Records the intent alone. Nothing yet relaunches an instance onto a revision it was not started at. */
  @Transactional()
  async apply(deploymentId: number, actorId: number): Promise<void> {
    const deployment = await this.findWithThrow(deploymentId);

    if (!this.isOutOfDate(deployment)) {
      return;
    }

    await this.applyRevisions([deployment], actorId);
  }

  /** Answers with how many deployments moved onto their current revision. */
  @Transactional()
  async applyAll(actorId: number): Promise<number> {
    const deployments = await this.outOfDateQuery().getMany();

    await this.applyRevisions(deployments, actorId);

    return deployments.length;
  }

  /** Drops the document keys the new backend has no field for, and announces the change once it is committed. */
  async update(deploymentId: number, definition: IDeploymentDefinition, actorId: number): Promise<void> {
    await this.writeUpdate(deploymentId, definition, actorId);

    // An edit is the operator's answer to a failing start, so it starts the next one without waiting out the backoff.
    await this.clearLaunchFailures(deploymentId);

    this.changed.next(deploymentId);
  }

  @Transactional()
  private async writeUpdate(deploymentId: number, definition: IDeploymentDefinition, actorId: number): Promise<void> {
    const deployment = await this.findWithThrow(deploymentId);

    const name = definition.name.trim();
    const presetId = definition.presetId;
    const preset = await this.resolvePreset(presetId, definition.backend);
    const description = definition.description.trim();
    const renamed = deployment.name.toLowerCase() !== name.toLowerCase();

    const model = await this.modelService.findWithThrow(definition.modelId);

    if (model.id !== deployment.modelId) {
      this.checkIsServable(model);
    }

    // A deployment saved before these checks stays editable while it keeps its model and backend.
    const unchanged = model.id === deployment.modelId && preset.backend === this.getBackend(deployment);

    if (!unchanged) {
      this.checkFormatIsLoaded(model, preset.backend);
      this.checkStagesAreKnown(model, preset.backend);
    }

    if (renamed) {
      await this.checkNameIsFree(name);
    }

    const dropped = this.orphanedKeys(deployment, definition.document, preset.backend);
    const document = this.configurationService.withoutKeys(definition.document, dropped);
    const stored = this.configurationService.derive(document, preset.backend);

    await this.modelReferenceService.checkIntroduced(
      { backend: this.getBackend(deployment), configuration: this.resolveConfiguration(deployment).configuration },
      {
        backend: preset.backend,
        configuration: this.effectiveOf(preset.backend, preset.configuration, stored.configuration),
      }
    );

    await this.deploymentRepository.update(
      { id: deployment.id },
      {
        name,
        modelId: model.id,
        presetId,
        backend: presetId === null ? preset.backend : null,
        activationPolicy: definition.activationPolicy,
        description: description.length > 0 ? description : null,
        ...stored,
        configurationRevision: this.revisionFor(preset.backend, model.id, preset.configuration, stored.configuration),
      }
    );

    await this.eventService.recordEvent(EventType.DEPLOYMENT_UPDATED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${deployment.id}`,
      message: `Updated deployment **${name}**`,
      detail: { name, previousName: deployment.name },
    });
  }

  /** Announces the deletion once it is committed, since a deployment's instances cascade away with it. */
  async remove(deploymentId: number, actorId: number): Promise<void> {
    await this.deleteDeployment(deploymentId, actorId);

    this.lastStamped.delete(deploymentId);
    this.removed.next(deploymentId);
  }

  /** A deployment whose rows have gone, so anything holding state for its instances can let go of it. */
  deploymentRemoved(): Observable<number> {
    return this.removed.asObservable();
  }

  launchFailureCounted(): Observable<ILaunchFailureCount> {
    return this.counted.asObservable();
  }

  /** A deployment edited, enabled or disabled, once the change is committed. */
  deploymentChanged(): Observable<number> {
    return this.changed.asObservable();
  }

  @Transactional()
  private async deleteDeployment(deploymentId: number, actorId: number): Promise<void> {
    const deployment = await this.findWithThrow(deploymentId);
    const modelName = deployment.model?.label ?? '';

    await this.deploymentRepository.delete({ id: deployment.id });

    await this.eventService.recordEvent(EventType.DEPLOYMENT_DELETED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.DEPLOYMENT,
      subjectId: `${deployment.id}`,
      message: `Deleted deployment **${deployment.name}**`,
      detail: { name: deployment.name, modelName },
    });
  }

  private async resolvePreset(presetId: number | null, backend: BackendId | null): Promise<IResolvedPreset> {
    if (presetId === null) {
      if (backend === null) {
        throw new BadRequestException(BACKEND_MISSING_MESSAGE);
      }

      return { backend, name: '', configuration: {}, row: null };
    }

    if (backend !== null) {
      throw new BadRequestException(BACKEND_WITH_PRESET_MESSAGE);
    }

    const preset = await this.presetService.findWithThrow(presetId);

    return { backend: preset.backend, name: preset.name, configuration: preset.configuration, row: preset };
  }

  /** Starts on the revision it is built at, since nothing has run it yet. */
  private assemble(fields: IDeploymentFields): Deployment {
    const { preset, stored } = fields;
    const revision = this.revisionFor(preset.backend, fields.modelId, preset.configuration, stored.configuration);

    return new Deployment({
      name: fields.name,
      modelId: fields.modelId,
      presetId: fields.presetId,
      backend: fields.presetId === null ? preset.backend : null,
      activationPolicy: fields.activationPolicy,
      description: fields.description,
      ...stored,
      configurationRevision: revision,
      appliedRevision: revision,
    });
  }

  private async applyRevisions(deployments: Deployment[], actorId: number): Promise<void> {
    for (const deployment of deployments) {
      await this.deploymentRepository.update(
        { id: deployment.id },
        { appliedRevision: deployment.configurationRevision }
      );

      await this.eventService.recordEvent(EventType.DEPLOYMENT_APPLIED, EventSeverity.INFO, {
        actorType: EventPartyType.USER,
        actorId: `${actorId}`,
        subjectType: EventPartyType.DEPLOYMENT,
        subjectId: `${deployment.id}`,
        message: `Applied deployment **${deployment.name}**`,
        detail: { name: deployment.name, revision: deployment.configurationRevision },
      });
    }
  }

  private outOfDateQuery(): SelectQueryBuilder<Deployment> {
    return this.deploymentRepository
      .createQueryBuilder('deployment')
      .where('deployment."appliedRevision" <> deployment."configurationRevision"');
  }

  /** Needs the preset relation loaded where the deployment names one. */
  private revisionOf(deployment: Deployment): string {
    return this.configurationRevisionService.revisionOf({
      backend: this.getBackend(deployment),
      modelId: deployment.modelId,
      configuration: this.resolveConfiguration(deployment).configuration,
    });
  }

  private revisionFor(
    backend: BackendId,
    modelId: number,
    presetConfiguration: ConfigurationDocument,
    overrides: ConfigurationDocument
  ): string {
    const effective = this.effectiveConfigurationService.resolve(
      backend,
      declarationFor(backend),
      presetConfiguration,
      overrides
    );

    return this.configurationRevisionService.revisionOf({ backend, modelId, configuration: effective.configuration });
  }

  private orphanedKeys(deployment: Deployment, document: string, backend: BackendId): string[] {
    return this.effectiveConfigurationService.orphanedKeys(
      this.declarationOf(deployment),
      declarationFor(backend),
      this.configurationService.parseDocument(document)
    );
  }

  /** A row whose backend will not resolve can name nothing, so one does not fail an unrelated delete. */
  private namesFingerprint(deployment: Deployment, fingerprint: string): boolean {
    try {
      return referencesModel(
        this.declarationOf(deployment),
        this.resolveConfiguration(deployment).configuration,
        fingerprint
      );
    } catch (error: unknown) {
      this.logger.warn({ error, deploymentId: deployment.id }, 'namesFingerprint(): A deployment could not be read');

      return false;
    }
  }

  private declarationOf(deployment: Deployment): BackendDeclaration {
    return declarationFor(this.getBackend(deployment));
  }

  private effectiveOf(
    backend: BackendId,
    presetConfiguration: ConfigurationDocument,
    overrides: ConfigurationDocument
  ): ConfigurationDocument {
    return this.effectiveConfigurationService.resolve(backend, declarationFor(backend), presetConfiguration, overrides)
      .configuration;
  }

  private checkIsServable(model: Model): void {
    const problem = servableProblem(model);

    if (problem !== null) {
      throw new BadRequestException(problem);
    }
  }

  private checkFormatIsLoaded(model: Model, backend: BackendId): void {
    const problem = formatProblem(model, backend);

    if (problem !== null) {
      throw new BadRequestException(problem);
    }
  }

  private checkStagesAreKnown(model: Model, backend: BackendId): void {
    const problem = stagesProblem(model, backend);

    if (problem !== null) {
      throw new BadRequestException(problem);
    }
  }

  private async checkNameIsFree(name: string): Promise<void> {
    const taken = await this.deploymentRepository
      .createQueryBuilder('deployment')
      .where('LOWER(deployment.name) = LOWER(:name)', { name })
      .getExists();

    if (taken) {
      throw new BadRequestException(DEPLOYMENT_NAME_TAKEN_MESSAGE);
    }
  }

  private async findReferences(where: { modelId?: number; presetId?: number }): Promise<IModelUsage[]> {
    const deployments = await this.deploymentRepository.find({ select: ['name'], where });

    return deployments.map(deployment => ({ kind: DEPLOYMENT_KIND, name: deployment.name }));
  }

  /** Read in full and filtered here, since a fingerprint sits in a document rather than a column. */
  private async findCompanionUsage(modelId: number): Promise<IModelUsage[]> {
    const { fingerprint } = await this.modelService.findWithThrow(modelId);
    const deployments = await this.deploymentRepository.find({ relations: { preset: true } });

    return deployments
      .filter(deployment => this.namesFingerprint(deployment, fingerprint))
      .map(deployment => ({ kind: DEPLOYMENT_KIND, name: deployment.name }));
  }
}
