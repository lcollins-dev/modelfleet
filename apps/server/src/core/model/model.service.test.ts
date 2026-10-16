import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelTask, ServerMessageType } from '@libs/agent-protocol';
import { EventPartyType, EventType } from '@libs/dto';

import { Availability } from '@/core/model/entities/availability.entity';
import { Model } from '@/core/model/entities/model.entity';

import { AgentConnectionService } from '@/core/agent/agent-connection.service';
import { EventService } from '@/core/event/event.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';

import { ModelUsageRegistry } from '@/core/model/model-usage.registry';
import { buildModel, TEST_FINGERPRINT, TEST_MODEL_ID as MODEL_ID } from '@/test/model.factory';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const ACTOR_ID = 7;
const NODE_ID = 3;

describe('ModelService', () => {
  let modelRepository: {
    findOne: ReturnType<typeof vi.fn>;
    findOneBy: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let availabilityRepository: { find: ReturnType<typeof vi.fn> };
  let agentConnectionService: { send: ReturnType<typeof vi.fn> };
  let eventService: { recordEvent: ReturnType<typeof vi.fn> };
  let modelUsageRegistry: ModelUsageRegistry;
  let modelService: ModelService;

  beforeEach(async () => {
    modelRepository = {
      findOne: vi.fn().mockResolvedValue(buildModel()),
      findOneBy: vi.fn().mockResolvedValue(buildModel()),
      find: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn(),
    };

    availabilityRepository = { find: vi.fn().mockResolvedValue([]) };
    agentConnectionService = { send: vi.fn() };
    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    modelUsageRegistry = new ModelUsageRegistry();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelService,
        { provide: AgentConnectionService, useValue: agentConnectionService },
        { provide: EventService, useValue: eventService },
        { provide: ModelUsageRegistry, useValue: modelUsageRegistry },
        { provide: NodeService, useValue: { getOfflineCutoff: vi.fn(() => new Date()) } },
        { provide: getRepositoryToken(Model), useValue: modelRepository },
        { provide: getRepositoryToken(Availability), useValue: availabilityRepository },
      ],
    }).compile();

    modelService = moduleRef.get(ModelService);
  });

  describe('findWithThrow', () => {
    it('refuses a model that does not exist', async () => {
      modelRepository.findOne.mockResolvedValue(null);

      await expect(modelService.findWithThrow(MODEL_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findNames', () => {
    it('asks for nothing when handed no ids', async () => {
      const names = await modelService.findNames([]);

      expect(names.size).toBe(0);
      expect(modelRepository.find).not.toHaveBeenCalled();
    });

    it('leaves a model that no longer exists out of the map', async () => {
      modelRepository.find.mockResolvedValue([buildModel()]);

      const names = await modelService.findNames([MODEL_ID, 99]);

      expect(names.get(MODEL_ID)).toBe('Llama 3 8B');
      expect(names.has(99)).toBe(false);
    });
  });

  describe('update', () => {
    it('stores a trimmed display name and records the rename from the scanned name', async () => {
      await modelService.update(MODEL_ID, { displayName: '  Llama chat  ' }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { displayName: 'Llama chat' });
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_RENAMED,
        expect.anything(),
        expect.objectContaining({
          actorId: `${ACTOR_ID}`,
          subjectType: EventPartyType.MODEL,
          subjectId: `${MODEL_ID}`,
          message: 'Renamed model **Llama 3 8B** to **Llama chat**',
          detail: { name: 'Llama chat', previousName: 'Llama 3 8B', fingerprint: TEST_FINGERPRINT },
        })
      );
    });

    it('clears a blank display name, recording the return to the scanned name', async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ displayName: 'Llama chat' }));

      await modelService.update(MODEL_ID, { displayName: '   ' }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { displayName: null });
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_RENAMED,
        expect.anything(),
        expect.objectContaining({ message: 'Renamed model **Llama chat** to **Llama 3 8B**' })
      );
    });

    it('stores a display name matching the scanned name as none', async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ displayName: 'Llama chat' }));

      await modelService.update(MODEL_ID, { displayName: 'Llama 3 8B' }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { displayName: null });
    });

    it('writes nothing where the label reads as it did', async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ displayName: 'Llama chat' }));

      await modelService.update(MODEL_ID, { displayName: ' Llama chat ' }, ACTOR_ID);

      expect(modelRepository.update).not.toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });

    it("stores an admin's tasks in task order, recording what the model was served as", async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ detectedTasks: [ModelTask.CHAT] }));

      await modelService.update(MODEL_ID, { tasks: [ModelTask.SPEECH, ModelTask.CHAT, ModelTask.SPEECH] }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith(
        { id: MODEL_ID },
        { assignedTasks: [ModelTask.CHAT, ModelTask.SPEECH] }
      );
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_TASKS_CHANGED,
        expect.anything(),
        expect.objectContaining({
          message: 'Set the tasks of model **Llama 3 8B** to chat, speech',
          detail: {
            name: 'Llama 3 8B',
            fingerprint: TEST_FINGERPRINT,
            tasks: 'chat,speech',
            previousTasks: 'chat',
            assigned: true,
          },
        })
      );
    });

    it("clears an admin's tasks on no tasks, returning the model to what its scans read", async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ detectedTasks: [], assignedTasks: [ModelTask.SPEECH] }));

      await modelService.update(MODEL_ID, { tasks: [] }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { assignedTasks: null });
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_TASKS_CHANGED,
        expect.anything(),
        expect.objectContaining({ message: 'Returned model **Llama 3 8B** to the tasks its scans read: unknown' })
      );
    });

    it('stores tasks matching what the scans read as none assigned', async () => {
      modelRepository.findOneBy.mockResolvedValue(
        buildModel({
          detectedTasks: [ModelTask.TRANSCRIPTION, ModelTask.CHAT],
          assignedTasks: [ModelTask.SPEECH],
        })
      );

      await modelService.update(MODEL_ID, { tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION] }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { assignedTasks: null });
    });

    it('clears an assignment a rescan caught up with, recording nothing since nothing served changed', async () => {
      const tasks = [ModelTask.CHAT, ModelTask.TRANSCRIPTION];

      modelRepository.findOneBy.mockResolvedValue(buildModel({ detectedTasks: tasks, assignedTasks: tasks }));

      await modelService.update(MODEL_ID, { tasks: [] }, ACTOR_ID);

      expect(modelRepository.update).toHaveBeenCalledWith({ id: MODEL_ID }, { assignedTasks: null });
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });

    it('writes nothing where the tasks read as they did', async () => {
      modelRepository.findOneBy.mockResolvedValue(buildModel({ assignedTasks: [ModelTask.CHAT, ModelTask.SPEECH] }));

      await modelService.update(MODEL_ID, { tasks: [ModelTask.SPEECH, ModelTask.CHAT] }, ACTOR_ID);

      expect(modelRepository.update).not.toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });

    it('leaves a field it is not given alone', async () => {
      modelRepository.findOneBy.mockResolvedValue(
        buildModel({ displayName: 'Llama chat', assignedTasks: [ModelTask.SPEECH] })
      );

      await modelService.update(MODEL_ID, {}, ACTOR_ID);

      expect(modelRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a model that does not exist', async () => {
      modelRepository.findOneBy.mockResolvedValue(null);

      await expect(modelService.update(MODEL_ID, { displayName: 'Llama chat' }, ACTOR_ID)).rejects.toBeInstanceOf(
        BadRequestException
      );

      expect(modelRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('requestScan', () => {
    it('asks the node to sweep what it is configured with', () => {
      modelService.requestScan(NODE_ID);

      expect(agentConnectionService.send).toHaveBeenCalledWith(NODE_ID, ServerMessageType.SCAN_MODELS, {});
    });
  });

  describe('remove', () => {
    it('deletes a model nothing references and records the removal', async () => {
      await modelService.remove(MODEL_ID, ACTOR_ID);

      expect(modelRepository.delete).toHaveBeenCalledWith({ id: MODEL_ID });
      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_DELETED,
        expect.anything(),
        expect.objectContaining({ actorType: EventPartyType.USER, subjectId: `${MODEL_ID}` })
      );
    });

    it('names the deleted model by its display name', async () => {
      modelRepository.findOne.mockResolvedValue(buildModel({ displayName: 'Llama chat' }));

      await modelService.remove(MODEL_ID, ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.MODEL_DELETED,
        expect.anything(),
        expect.objectContaining({ message: 'Deleted model **Llama chat**' })
      );
    });

    it('refuses a model a registered source still points at, naming what holds it', async () => {
      modelUsageRegistry.register({
        findModelUsage: () => Promise.resolve([{ kind: 'deployment', name: 'llama-chat' }]),
      });

      await expect(modelService.remove(MODEL_ID, ACTOR_ID)).rejects.toThrow('llama-chat');

      expect(modelRepository.delete).not.toHaveBeenCalled();
    });

    it('names every source holding the model', async () => {
      modelUsageRegistry.register({
        findModelUsage: () =>
          Promise.resolve([
            { kind: 'deployment', name: 'llama-chat' },
            { kind: 'deployment', name: 'llama-batch' },
          ]),
      });

      await expect(modelService.remove(MODEL_ID, ACTOR_ID)).rejects.toThrow(
        'This model is in use by deployment "llama-chat", deployment "llama-batch"'
      );
    });
  });
});
