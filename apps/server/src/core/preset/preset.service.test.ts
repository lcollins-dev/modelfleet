import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { BackendId, ModelType } from '@libs/backends';
import { EventPartyType, EventType } from '@libs/dto';

import { Model } from '@/core/model/entities/model.entity';
import { Preset } from '@/core/preset/entities/preset.entity';

import { ConfigurationService } from '@/core/configuration/configuration.service';
import { EventService } from '@/core/event/event.service';
import { ModelReferenceService } from '@/core/model/model-reference.service';
import { ModelService } from '@/core/model/model.service';
import { IPresetDefinition, PresetService } from '@/core/preset/preset.service';

import { ModelUsageRegistry } from '@/core/model/model-usage.registry';
import { PresetReferenceRegistry } from '@/core/preset/preset-reference.registry';
import { buildModel } from '@/test/model.factory';
import { buildPreset, TEST_PRESET_ID as PRESET_ID } from '@/test/preset.factory';
import { issuePathsFrom } from '@/test/validation';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const ACTOR_ID = 7;
const PROJECTOR_ID = 77;
const PROJECTOR_FINGERPRINT = 'b'.repeat(64);

const buildProjector = (overrides: Partial<Model> = {}) =>
  buildModel({ id: PROJECTOR_ID, fingerprint: PROJECTOR_FINGERPRINT, type: ModelType.PROJECTOR, ...overrides });

const definition = (overrides: Partial<IPresetDefinition> = {}): IPresetDefinition => ({
  name: 'Single 4090',
  description: '',
  backend: BackendId.LLAMA_CPP,
  document: 'image: llama:latest\nthreads: 16\n',
  ...overrides,
});

describe('PresetService', () => {
  let presetRepository: {
    findOne: ReturnType<typeof vi.fn>;
    find: Mock<() => Promise<Preset[]>>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let modelService: {
    findWithThrow: ReturnType<typeof vi.fn>;
    findByFingerprints: ReturnType<typeof vi.fn>;
  };
  let modelUsageRegistry: ModelUsageRegistry;
  let presetReferenceRegistry: PresetReferenceRegistry;
  let presetService: PresetService;
  let nameTaken: boolean;

  beforeEach(async () => {
    nameTaken = false;

    presetRepository = {
      findOne: vi.fn().mockResolvedValue(buildPreset()),
      find: vi.fn(() => Promise.resolve<Preset[]>([])),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn(() => ({
        where: vi.fn().mockReturnThis(),
        getExists: vi.fn(() => Promise.resolve(nameTaken)),
      })),
    };

    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    modelService = {
      findWithThrow: vi.fn(() => Promise.resolve(buildProjector())),
      findByFingerprints: vi.fn(() => Promise.resolve(new Map())),
    };
    modelUsageRegistry = new ModelUsageRegistry();
    presetReferenceRegistry = new PresetReferenceRegistry();

    const moduleRef = await Test.createTestingModule({
      providers: [
        PresetService,
        ConfigurationService,
        ModelReferenceService,
        { provide: EventService, useValue: eventService },
        { provide: ModelService, useValue: modelService },
        { provide: ModelUsageRegistry, useValue: modelUsageRegistry },
        { provide: PresetReferenceRegistry, useValue: presetReferenceRegistry },
        { provide: getRepositoryToken(Preset), useValue: presetRepository },
      ],
    }).compile();

    presetService = moduleRef.get(PresetService);
    presetService.onModuleInit();
  });

  describe('the companion a preset names', () => {
    const document = `threads: 16\nmmproj: ${PROJECTOR_FINGERPRINT}\n`;

    it('stores a fingerprint the catalogue holds as a projector', async () => {
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));

      const preset = await presetService.create(definition({ document }), ACTOR_ID);

      expect(preset.configuration).toMatchObject({ mmproj: PROJECTOR_FINGERPRINT });
    });

    it('refuses a fingerprint the catalogue does not hold, rather than leaving it for every deployment', async () => {
      modelService.findByFingerprints.mockResolvedValue(new Map());

      await expect(presetService.create(definition({ document }), ACTOR_ID)).rejects.toThrow('not in the catalogue');
      expect(presetRepository.insert).not.toHaveBeenCalled();
    });

    it('refuses a fingerprint naming a file of the wrong type', async () => {
      modelService.findByFingerprints.mockResolvedValue(
        new Map([[PROJECTOR_FINGERPRINT, buildProjector({ type: ModelType.LORA, name: 'Gemma LoRA' })]])
      );

      await expect(presetService.create(definition({ document }), ACTOR_ID)).rejects.toThrow(
        'Gemma LoRA is a LoRA adapter, and Projector takes a multimodal projector'
      );
    });

    it('refuses an update that moves onto a fingerprint the catalogue does not hold', async () => {
      modelService.findByFingerprints.mockResolvedValue(new Map());

      await expect(
        presetService.update(PRESET_ID, { name: 'Single 4090', description: '', document }, ACTOR_ID)
      ).rejects.toThrow('not in the catalogue');
      expect(presetRepository.update).not.toHaveBeenCalled();
    });

    it('lets an unrelated edit through where the projector it already named was re-typed', async () => {
      const retyped = buildProjector({ type: ModelType.LORA });

      presetRepository.findOne.mockResolvedValue(buildPreset({ configuration: { mmproj: PROJECTOR_FINGERPRINT } }));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, retyped]]));

      await presetService.update(PRESET_ID, { name: 'Renamed', description: '', document }, ACTOR_ID);

      expect(presetRepository.update).toHaveBeenCalled();
    });

    it('holds a projector it names, so deleting that projector is refused', async () => {
      presetRepository.find.mockImplementation(() =>
        Promise.resolve([buildPreset({ configuration: { mmproj: PROJECTOR_FINGERPRINT } })])
      );

      await expect(modelUsageRegistry.findUsage(PROJECTOR_ID)).resolves.toEqual([
        { kind: 'preset', name: 'Single 4090' },
      ]);
    });

    it('holds no projector where none of its fields names one', async () => {
      presetRepository.find.mockImplementation(() =>
        Promise.resolve([buildPreset({ configuration: { threads: 16 } })])
      );

      await expect(modelUsageRegistry.findUsage(PROJECTOR_ID)).resolves.toEqual([]);
    });
  });

  describe('create', () => {
    it('stores the document and the form derived from it together', async () => {
      const preset = await presetService.create(definition(), ACTOR_ID);

      expect(preset.document).toBe('image: llama:latest\nthreads: 16\n');
      expect(preset.configuration).toEqual({ image: 'llama:latest', threads: 16 });
      expect(preset.schemaVersion).toBe(1);
      expect(presetRepository.insert).toHaveBeenCalledWith(preset);
    });

    it('records the creation against the actor', async () => {
      await presetService.create(definition(), ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.PRESET_CREATED,
        expect.anything(),
        expect.objectContaining({ actorType: EventPartyType.USER, subjectType: EventPartyType.PRESET })
      );
    });

    it('refuses a name another preset already holds', async () => {
      nameTaken = true;

      await expect(presetService.create(definition(), ACTOR_ID)).rejects.toThrow('already exists');
    });

    it('refuses a document the backend declaration rejects', async () => {
      await expect(
        issuePathsFrom(() =>
          presetService.create(definition({ document: 'image: llama:latest\nthreads: 0\n' }), ACTOR_ID)
        )
      ).resolves.toEqual(['threads']);

      expect(presetRepository.insert).not.toHaveBeenCalled();
    });

    it('stores no image where the document names none, leaving the backend its tested one', async () => {
      const preset = await presetService.create(definition({ document: 'threads: 16\n' }), ACTOR_ID);

      expect(preset.configuration).toEqual({ threads: 16 });
    });
  });

  describe('update', () => {
    it('revalidates the document against the backend the preset was created with', async () => {
      await presetService.update(PRESET_ID, { name: 'Single 4090', description: '', document: 'image: a\n' }, ACTOR_ID);

      expect(presetRepository.update).toHaveBeenCalledWith(
        { id: PRESET_ID },
        expect.objectContaining({ document: 'image: a\n', configuration: { image: 'a' }, schemaVersion: 1 })
      );
    });

    it('tells the registered sources the configuration moved, so what derives from it catches up', async () => {
      const onPresetConfigurationChanged = vi.fn().mockResolvedValue(undefined);
      presetReferenceRegistry.register({
        findPresetReferences: () => Promise.resolve([]),
        onPresetConfigurationChanged,
      });

      await presetService.update(PRESET_ID, { name: 'Single 4090', description: '', document: 'image: a\n' }, ACTOR_ID);

      expect(onPresetConfigurationChanged).toHaveBeenCalledWith(PRESET_ID);
    });

    it('refuses a rename onto a name another preset holds', async () => {
      nameTaken = true;

      await expect(
        presetService.update(PRESET_ID, { name: 'Dual 3090', description: '', document: 'image: a\n' }, ACTOR_ID)
      ).rejects.toThrow('already exists');
    });
  });

  describe('remove', () => {
    it('deletes a preset nothing references', async () => {
      await presetService.remove(PRESET_ID, ACTOR_ID);

      expect(presetRepository.delete).toHaveBeenCalledWith({ id: PRESET_ID });
    });

    it('refuses a preset a registered source still points at, naming what holds it', async () => {
      presetReferenceRegistry.register({
        findPresetReferences: () => Promise.resolve([{ kind: 'deployment', name: 'llama-chat' }]),
        onPresetConfigurationChanged: () => Promise.resolve(),
      });

      await expect(presetService.remove(PRESET_ID, ACTOR_ID)).rejects.toThrow(
        'This preset is in use by deployment "llama-chat"'
      );

      expect(presetRepository.delete).not.toHaveBeenCalled();
    });
  });

  describe('findWithThrow', () => {
    it('refuses a preset that does not exist', async () => {
      presetRepository.findOne.mockResolvedValue(null);

      await expect(presetService.findWithThrow(PRESET_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
