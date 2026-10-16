import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentModelInventory,
  GgufMetadata,
  ModelEntry,
  ModelFormat,
  ModelTask,
  ModelType,
  ProjectorModality,
} from '@libs/agent-protocol';
import { EventSeverity, EventType } from '@libs/dto';

import { Availability } from '@/core/model/entities/availability.entity';
import { Model } from '@/core/model/entities/model.entity';

import { EventService } from '@/core/event/event.service';
import { ModelCatalogueService } from '@/core/model/model-catalogue.service';
import { NodeService } from '@/core/node/node.service';

import { buildAvailability, buildModel, TEST_FINGERPRINT, TEST_MODEL_ID } from '@/test/model.factory';
import { TEST_NODE_ID as NODE_ID } from '@/test/node.factory';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

interface IRecordedEvent {
  actorId?: string;
  subjectId?: string;
  message?: string;
  detail: Record<string, unknown>;
}

const OTHER_FINGERPRINT = 'b'.repeat(64);
const CONFIRMED_DATE = new Date('2026-08-24T12:00:00.000Z');

/** What an older scan recorded off `general.file_type`, against what the tensors actually hold. */
const STALE_METADATA: GgufMetadata = {
  architecture: 'qwen3',
  quantisation: 'Q4_K_M',
  quantisationMixed: false,
  layerCount: 28,
  embeddingLength: 1024,
  headCount: 16,
  headCountKv: 8,
  contextLength: 40960,
};

const READ_METADATA: GgufMetadata = {
  ...STALE_METADATA,
  quantisation: 'Q8_0',
  quantisationMixed: true,
};

const entry = (overrides: Partial<ModelEntry> = {}): ModelEntry => ({
  fingerprint: TEST_FINGERPRINT,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  sizeBytes: 4_920_000_000,
  path: '/models/llama-3-8b.gguf',
  shardCount: 1,
  name: 'Llama 3 8B',
  ggufMetadata: null,
  safetensorsMetadata: null,
  ...overrides,
});

const inventory = (models: ModelEntry[]): AgentModelInventory => ({
  scannedAt: '2026-08-24T12:00:00.000Z',
  directories: ['/models'],
  models,
  errors: [],
});

describe('ModelCatalogueService', () => {
  let modelRepository: {
    find: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let availabilityRepository: {
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let modelCatalogueService: ModelCatalogueService;

  beforeEach(async () => {
    let nextModelId = TEST_MODEL_ID;

    modelRepository = {
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockImplementation((model: Model) => {
        model.id = nextModelId++;

        return Promise.resolve(undefined);
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };

    availabilityRepository = {
      find: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelCatalogueService,
        { provide: EventService, useValue: eventService },
        { provide: NodeService, useValue: { findNames: vi.fn().mockResolvedValue(new Map([[NODE_ID, 'rig-01']])) } },
        { provide: getRepositoryToken(Model), useValue: modelRepository },
        { provide: getRepositoryToken(Availability), useValue: availabilityRepository },
      ],
    }).compile();

    modelCatalogueService = moduleRef.get(ModelCatalogueService);
  });

  it('records a model and an availability entry for a fingerprint nothing has reported', async () => {
    await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry()]), CONFIRMED_DATE);

    expect(modelRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: TEST_FINGERPRINT, name: 'Llama 3 8B', shardCount: 1 })
    );
    expect(availabilityRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: TEST_MODEL_ID,
        nodeId: NODE_ID,
        path: '/models/llama-3-8b.gguf',
        lastConfirmedDate: CONFIRMED_DATE,
      })
    );
  });

  it('adds an availability entry rather than a second model for a fingerprint another node reported', async () => {
    modelRepository.findOne.mockResolvedValue(buildModel());

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ path: '/srv/weights/llama.gguf' })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.insert).not.toHaveBeenCalled();
    expect(availabilityRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: TEST_MODEL_ID, nodeId: NODE_ID, path: '/srv/weights/llama.gguf' })
    );
  });

  it('holds two fine-tunes of one size and quantisation as two models', async () => {
    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry(), entry({ fingerprint: OTHER_FINGERPRINT, path: '/models/tuned.gguf', name: 'Tuned' })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.insert).toHaveBeenCalledTimes(2);
    expect(availabilityRepository.insert).toHaveBeenCalledTimes(2);
  });

  it('takes the new path on the entry a moved model already has', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability({ path: '/models/old/llama-3-8b.gguf' })]);
    modelRepository.find.mockResolvedValue([buildModel()]);

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ path: '/models/new/llama-3-8b.gguf' })]),
      CONFIRMED_DATE
    );

    expect(availabilityRepository.update).toHaveBeenCalledWith(
      { id: 1 },
      { path: '/models/new/llama-3-8b.gguf', lastConfirmedDate: CONFIRMED_DATE }
    );
    expect(modelRepository.insert).not.toHaveBeenCalled();
    expect(availabilityRepository.insert).not.toHaveBeenCalled();
    expect(availabilityRepository.delete).not.toHaveBeenCalled();
  });

  it('corrects the metadata an earlier scan read wrongly, on an entry the node already holds', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel({ ggufMetadata: STALE_METADATA })]);

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ ggufMetadata: READ_METADATA })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.update).toHaveBeenCalledWith(
      { id: TEST_MODEL_ID },
      expect.objectContaining({ type: ModelType.MODEL, ggufMetadata: READ_METADATA, safetensorsMetadata: null })
    );
  });

  it('corrects the metadata of a model another node reported first', async () => {
    modelRepository.findOne.mockResolvedValue(buildModel({ ggufMetadata: STALE_METADATA }));

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ ggufMetadata: READ_METADATA })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.update).toHaveBeenCalledWith(
      { id: TEST_MODEL_ID },
      expect.objectContaining({ type: ModelType.MODEL, ggufMetadata: READ_METADATA, safetensorsMetadata: null })
    );
  });

  it('takes the real type of a file an earlier agent catalogued as a model, in the row it already has', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel()]);

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ type: ModelType.PROJECTOR })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.update).toHaveBeenCalledWith(
      { id: TEST_MODEL_ID },
      expect.objectContaining({ type: ModelType.PROJECTOR, ggufMetadata: null, safetensorsMetadata: null })
    );
    expect(modelRepository.insert).not.toHaveBeenCalled();
  });

  it('takes the real type of a model a second node reports differently, without a second row', async () => {
    modelRepository.findOne.mockResolvedValue(buildModel());

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ type: ModelType.PROJECTOR })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.update).toHaveBeenCalledWith(
      { id: TEST_MODEL_ID },
      expect.objectContaining({ type: ModelType.PROJECTOR, ggufMetadata: null, safetensorsMetadata: null })
    );
    expect(modelRepository.insert).not.toHaveBeenCalled();
  });

  it('leaves the type alone where the reporting agent states none, so an old node cannot undo a new one', async () => {
    const reported: ModelEntry = { ...entry(), type: undefined };

    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel({ type: ModelType.PROJECTOR })]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([reported]), CONFIRMED_DATE);

    expect(modelRepository.update).not.toHaveBeenCalled();
  });

  describe('the tasks, licence and modalities', () => {
    const NON_COMMERCIAL = { id: 'cc-by-nc-4.0', name: null, link: null };

    beforeEach(() => {
      availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    });

    it('writes what a newer agent read onto the row an older one created', async () => {
      modelRepository.find.mockResolvedValue([buildModel()]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ tasks: [ModelTask.SPEECH], licence: NON_COMMERCIAL, modalities: null })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).toHaveBeenCalledWith(
        { id: TEST_MODEL_ID },
        expect.objectContaining({ detectedTasks: [ModelTask.SPEECH], licence: NON_COMMERCIAL, modalities: null })
      );
    });

    it('leaves them alone where the reporting agent predates them', async () => {
      const model = buildModel({
        detectedTasks: [ModelTask.SPEECH],
        licence: NON_COMMERCIAL,
        modalities: [ProjectorModality.AUDIO],
      });

      modelRepository.find.mockResolvedValue([model]);

      await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry()]), CONFIRMED_DATE);

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it('keeps them where a node missing the model card reports none, so two nodes cannot flip the row', async () => {
      modelRepository.find.mockResolvedValue([
        buildModel({ detectedTasks: [ModelTask.CHAT], licence: NON_COMMERCIAL }),
      ]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ tasks: [], licence: null, modalities: null })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it('writes them onto the row it creates', async () => {
      availabilityRepository.find.mockResolvedValue([]);
      modelRepository.findOne.mockResolvedValue(null);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION], licence: NON_COMMERCIAL })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          detectedTasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION],
          assignedTasks: null,
          licence: NON_COMMERCIAL,
          modalities: null,
        })
      );
    });

    it('lets an agent predating task sets fill no tasks, but never narrow a set a newer one read', async () => {
      modelRepository.find.mockResolvedValue([
        buildModel({ detectedTasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION] }),
      ]);

      await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry({ task: ModelTask.CHAT })]), CONFIRMED_DATE);

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it('drops a task an agent reports twice, so the row compares equal to the next report', async () => {
      modelRepository.find.mockResolvedValue([buildModel({ detectedTasks: [ModelTask.CHAT] })]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ tasks: [ModelTask.CHAT, ModelTask.CHAT] })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it("keeps a safetensors model's architecture through a report from an agent predating the field", async () => {
      const metadata = { dtype: 'BF16', tensorCount: 400, parameterCount: 600_000_000 };

      modelRepository.find.mockResolvedValue([
        buildModel({
          format: ModelFormat.SAFETENSORS,
          safetensorsMetadata: { ...metadata, architecture: 'qwen3_tts' },
        }),
      ]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ format: ModelFormat.SAFETENSORS, safetensorsMetadata: metadata })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it('fills in the architecture a rescan reads for a safetensors model catalogued without one', async () => {
      const metadata = { dtype: 'BF16', tensorCount: 400, parameterCount: 600_000_000 };

      modelRepository.find.mockResolvedValue([
        buildModel({ format: ModelFormat.SAFETENSORS, safetensorsMetadata: metadata }),
      ]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([
          entry({ format: ModelFormat.SAFETENSORS, safetensorsMetadata: { ...metadata, architecture: 'qwen3_tts' } }),
        ]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).toHaveBeenCalledWith(
        { id: TEST_MODEL_ID },
        expect.objectContaining({ safetensorsMetadata: { ...metadata, architecture: 'qwen3_tts' } })
      );
    });

    it('reads the single task an agent predating task sets reports', async () => {
      modelRepository.find.mockResolvedValue([buildModel()]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ task: ModelTask.TRANSCRIPTION })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).toHaveBeenCalledWith(
        { id: TEST_MODEL_ID },
        expect.objectContaining({ detectedTasks: [ModelTask.TRANSCRIPTION] })
      );
    });

    it("rewrites the detected tasks but never an admin's", async () => {
      modelRepository.find.mockResolvedValue([
        buildModel({ detectedTasks: [ModelTask.CHAT], assignedTasks: [ModelTask.CHAT, ModelTask.SPEECH] }),
      ]);

      await modelCatalogueService.mergeInventory(
        NODE_ID,
        inventory([entry({ tasks: [ModelTask.EMBEDDING] })]),
        CONFIRMED_DATE
      );

      expect(modelRepository.update).toHaveBeenCalledWith(
        { id: TEST_MODEL_ID },
        expect.objectContaining({ detectedTasks: [ModelTask.EMBEDDING] })
      );
      expect(modelRepository.update.mock.calls[0][1]).not.toHaveProperty('assignedTasks');
    });
  });

  it('rewrites the size, so a repository whose subdirectories a newer agent counts is sized whole', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel({ sizeBytes: 1000 })]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry({ sizeBytes: 3000 })]), CONFIRMED_DATE);

    expect(modelRepository.update).toHaveBeenCalledWith(
      { id: TEST_MODEL_ID },
      expect.objectContaining({ sizeBytes: 3000 })
    );
  });

  it('writes the type a node reports onto the model row it creates', async () => {
    modelRepository.findOne.mockResolvedValue(null);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry({ type: ModelType.LORA })]), CONFIRMED_DATE);

    expect(modelRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ type: ModelType.LORA }));
  });

  it('keeps the name the node that found the model first gave it', async () => {
    const model = buildModel({ ggufMetadata: STALE_METADATA });

    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([model]);

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ name: 'Qwen3 0.6B', ggufMetadata: READ_METADATA })]),
      CONFIRMED_DATE
    );

    expect(model.name).toBe('Llama 3 8B');
    expect(model.ggufMetadata).toEqual(READ_METADATA);
  });

  it('writes nothing where a rescan reads a model the same as the catalogue holds', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel({ ggufMetadata: READ_METADATA })]);

    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ ggufMetadata: READ_METADATA })]),
      CONFIRMED_DATE
    );

    expect(modelRepository.update).not.toHaveBeenCalled();
  });

  it('stamps the entry of a model the report still names', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel()]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry()]), CONFIRMED_DATE);

    expect(availabilityRepository.update).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({ lastConfirmedDate: CONFIRMED_DATE })
    );
  });

  it('drops the entry of a model the report no longer names, and records the removal', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel()]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([]), CONFIRMED_DATE);

    const [type, , options] = eventService.recordEvent.mock.calls[0] as [EventType, EventSeverity, IRecordedEvent];

    expect(availabilityRepository.delete).toHaveBeenCalledOnce();
    expect(type).toBe(EventType.MODEL_AVAILABILITY_REMOVED);
    expect(options.subjectId).toBe(`${TEST_MODEL_ID}`);
    expect(options.detail.fingerprint).toBe(TEST_FINGERPRINT);
    expect(options.detail.path).toBe('/models/llama-3-8b.gguf');
  });

  it('names a dropped model by its scanned name, never its display name', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel({ displayName: 'Llama chat' })]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([]), CONFIRMED_DATE);

    const [, , options] = eventService.recordEvent.mock.calls[0] as [EventType, EventSeverity, IRecordedEvent];

    expect(options.message).toBe('Node **rig-01** no longer holds model **Llama 3 8B**');
    expect(options.detail.name).toBe('Llama 3 8B');
  });

  it('leaves the model row behind when its last entry on a node is dropped', async () => {
    availabilityRepository.find.mockResolvedValue([buildAvailability()]);
    modelRepository.find.mockResolvedValue([buildModel()]);

    await modelCatalogueService.mergeInventory(NODE_ID, inventory([]), CONFIRMED_DATE);

    expect(modelRepository.insert).not.toHaveBeenCalled();
    expect(availabilityRepository.delete).toHaveBeenCalledOnce();
  });

  it('records a discovery against the node that reported it', async () => {
    await modelCatalogueService.mergeInventory(NODE_ID, inventory([entry()]), CONFIRMED_DATE);

    const [type, , options] = eventService.recordEvent.mock.calls[0] as [EventType, EventSeverity, IRecordedEvent];

    expect(type).toBe(EventType.MODEL_DISCOVERED);
    expect(options.actorId).toBe(`${NODE_ID}`);
    expect(options.message).toContain('rig-01');
    expect(options.message).toContain('a new model');
  });

  it('names what a discovered file is, so the record does not call a companion a model', async () => {
    await modelCatalogueService.mergeInventory(
      NODE_ID,
      inventory([entry({ type: ModelType.PROJECTOR })]),
      CONFIRMED_DATE
    );

    const [, , options] = eventService.recordEvent.mock.calls[0] as [EventType, EventSeverity, IRecordedEvent];

    expect(options.message).toContain('a new multimodal projector');
    expect(options.detail).toMatchObject({ type: ModelType.PROJECTOR });
  });

  it('takes a node holding nothing as a valid report', async () => {
    await modelCatalogueService.mergeInventory(NODE_ID, inventory([]), CONFIRMED_DATE);

    expect(availabilityRepository.insert).not.toHaveBeenCalled();
    expect(availabilityRepository.delete).not.toHaveBeenCalled();
  });
});
