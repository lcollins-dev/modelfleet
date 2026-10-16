import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';

import { BackendId, declarationFor, referencesModel } from '@libs/backends';
import { EventPartyType, EventSeverity, EventType } from '@libs/dto';

import { Preset } from './entities/preset.entity';

import { ConfigurationService } from '../configuration/configuration.service';
import { EventService } from '../event/event.service';
import { ModelReferenceService } from '../model/model-reference.service';
import { ModelService } from '../model/model.service';

import { IModelUsage, IModelUsageSource, ModelUsageRegistry } from '../model/model-usage.registry';
import { PresetReferenceRegistry } from './preset-reference.registry';

const PRESET_MISSING_MESSAGE = 'This preset does not exist';
const PRESET_NAME_TAKEN_MESSAGE = 'A preset with this name already exists';
const BACKEND_UNKNOWN_MESSAGE = 'This backend is not supported';

const PRESET_KIND = 'preset';

export interface IPresetCriteria {
  search?: string;
  backend?: BackendId[];
}

export interface IPresetFields {
  name: string;
  description: string;
  document: string;
}

export interface IPresetDefinition extends IPresetFields {
  backend: BackendId;
}

@Injectable()
export class PresetService implements OnModuleInit, IModelUsageSource {
  constructor(
    private readonly modelReferenceService: ModelReferenceService,
    private readonly configurationService: ConfigurationService,
    private readonly eventService: EventService,
    private readonly modelUsageRegistry: ModelUsageRegistry,
    private readonly modelService: ModelService,
    private readonly presetReferenceRegistry: PresetReferenceRegistry,
    @InjectRepository(Preset) private readonly presetRepository: Repository<Preset>
  ) {}

  onModuleInit(): void {
    this.modelUsageRegistry.register(this);
  }

  /** A preset holds a model only by naming its fingerprint in a reference field. */
  async findModelUsage(modelId: number): Promise<IModelUsage[]> {
    const { fingerprint } = await this.modelService.findWithThrow(modelId);
    const presets = await this.presetRepository.find();

    return presets
      .filter(preset => referencesModel(declarationFor(preset.backend), preset.configuration, fingerprint))
      .map(preset => ({ kind: PRESET_KIND, name: preset.name }));
  }

  @Transactional()
  async create(definition: IPresetDefinition, actorId: number): Promise<Preset> {
    const name = definition.name.trim();
    const description = definition.description.trim();

    await this.checkNameIsFree(name);
    this.checkBackendIsKnown(definition.backend);

    const stored = this.configurationService.derive(definition.document, definition.backend);
    await this.modelReferenceService.checkIntroduced(
      { backend: definition.backend, configuration: {} },
      { backend: definition.backend, configuration: stored.configuration }
    );

    const preset = new Preset({
      name,
      description: description.length > 0 ? description : null,
      backend: definition.backend,
      ...stored,
    });
    await this.presetRepository.insert(preset);

    await this.eventService.recordEvent(EventType.PRESET_CREATED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.PRESET,
      subjectId: `${preset.id}`,
      message: `Created preset **${preset.name}**`,
      detail: { name: preset.name, backend: preset.backend },
    });

    return preset;
  }

  /** Ordered by name. */
  findAndCount(criteria: IPresetCriteria, skip: number, take: number): Promise<[Preset[], number]> {
    const queryBuilder = this.presetRepository.createQueryBuilder('preset');

    if (criteria.search !== undefined) {
      queryBuilder.andWhere(
        new Brackets(where => {
          where
            .where('LOWER(preset.name) LIKE LOWER(:search)', { search: `%${criteria.search}%` })
            .orWhere('LOWER(preset.description) LIKE LOWER(:search)', { search: `%${criteria.search}%` });
        })
      );
    }

    if (criteria.backend !== undefined) {
      queryBuilder.andWhere('preset.backend IN (:...backend)', { backend: criteria.backend });
    }

    return queryBuilder
      .orderBy('LOWER(preset.name)', 'ASC')
      .addOrderBy('preset.id', 'ASC')
      .take(take)
      .skip(skip)
      .getManyAndCount();
  }

  async findWithThrow(presetId: number): Promise<Preset> {
    const preset = await this.presetRepository.findOne({ where: { id: presetId } });

    if (!preset) {
      throw new BadRequestException(PRESET_MISSING_MESSAGE);
    }

    return preset;
  }

  /** A preset that no longer exists is absent from the map, not an error. */
  async findNames(presetIds: number[]): Promise<Map<number, string>> {
    if (presetIds.length === 0) {
      return new Map();
    }

    const presets = await this.presetRepository.find({ select: ['id', 'name'], where: { id: In(presetIds) } });

    return new Map(presets.map(preset => [preset.id, preset.name]));
  }

  /**
   * Revalidates the document against the backend the preset was created with, then tells the registered sources,
   * so a deployment inheriting a relaunch-required key this moved reads as out of date.
   */
  @Transactional()
  async update(presetId: number, fields: IPresetFields, actorId: number): Promise<void> {
    const preset = await this.findWithThrow(presetId);

    const name = fields.name.trim();
    const description = fields.description.trim();
    const renamed = preset.name.toLowerCase() !== name.toLowerCase();

    if (renamed) {
      await this.checkNameIsFree(name);
    }

    const stored = this.configurationService.derive(fields.document, preset.backend);
    await this.modelReferenceService.checkIntroduced(
      { backend: preset.backend, configuration: preset.configuration },
      { backend: preset.backend, configuration: stored.configuration }
    );

    await this.presetRepository.update(
      { id: preset.id },
      {
        name,
        description: description.length > 0 ? description : null,
        ...stored,
      }
    );

    await this.presetReferenceRegistry.configurationChanged(preset.id);

    await this.eventService.recordEvent(EventType.PRESET_UPDATED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.PRESET,
      subjectId: `${preset.id}`,
      message: `Updated preset **${name}**`,
      detail: { name, previousName: preset.name },
    });
  }

  /** Refused while anything registered with `PresetReferenceRegistry` still points at the preset. */
  @Transactional()
  async remove(presetId: number, actorId: number): Promise<void> {
    const preset = await this.findWithThrow(presetId);
    const references = await this.presetReferenceRegistry.findReferences(preset.id);

    if (references.length > 0) {
      const held = references.map(reference => `${reference.kind} "${reference.name}"`).join(', ');

      throw new BadRequestException(`This preset is in use by ${held}`);
    }

    await this.presetRepository.delete({ id: preset.id });

    await this.eventService.recordEvent(EventType.PRESET_DELETED, EventSeverity.INFO, {
      actorType: EventPartyType.USER,
      actorId: `${actorId}`,
      subjectType: EventPartyType.PRESET,
      subjectId: `${preset.id}`,
      message: `Deleted preset **${preset.name}**`,
      detail: { name: preset.name, backend: preset.backend },
    });
  }

  private async checkNameIsFree(name: string): Promise<void> {
    const taken = await this.presetRepository
      .createQueryBuilder('preset')
      .where('LOWER(preset.name) = LOWER(:name)', { name })
      .getExists();

    if (taken) {
      throw new BadRequestException(PRESET_NAME_TAKEN_MESSAGE);
    }
  }

  private checkBackendIsKnown(backend: BackendId): void {
    if (!Object.values(BackendId).includes(backend)) {
      throw new BadRequestException(BACKEND_UNKNOWN_MESSAGE);
    }
  }
}
