import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LicenceTerms,
  ModelFormat,
  ModelState,
  ModelTask,
  ModelType,
  NodeState,
  ProjectorModality,
  UNKNOWN_MODEL_TASK,
} from '@libs/dto';

import { Node } from '@/core/node/entities/node.entity';

import { ModelAdminService } from '@/api/v1/model/model-admin.service';
import { ConfigService } from '@/config/config.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';

import { buildAvailability, buildModel } from '@/test/model.factory';
import { buildNode } from '@/test/node.factory';

const PAGE_SIZE = 5;
const ONLINE_NODE_ID = 42;
const OFFLINE_NODE_ID = 43;

const onlineNode = () => buildNode({ id: ONLINE_NODE_ID, name: 'rig-01' });
const offlineNode = () => buildNode({ id: OFFLINE_NODE_ID, name: 'rig-02' });

describe('ModelAdminService', () => {
  let modelService: {
    findAndCount: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    findAvailabilityByNode: ReturnType<typeof vi.fn>;
    requestScan: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  let modelAdminService: ModelAdminService;

  beforeEach(async () => {
    modelService = {
      findAndCount: vi.fn().mockResolvedValue([[], 0]),
      findWithThrow: vi.fn().mockResolvedValue(buildModel({ availability: [] })),
      findAvailabilityByNode: vi.fn().mockResolvedValue([]),
      requestScan: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelAdminService,
        { provide: ConfigService, useValue: { pageSize: PAGE_SIZE } },
        { provide: ModelService, useValue: modelService },
        {
          provide: NodeService,
          useValue: {
            getState: vi.fn((node: Node) => (node.id === ONLINE_NODE_ID ? NodeState.ONLINE : NodeState.OFFLINE)),
            findWithThrow: vi.fn().mockResolvedValue(buildNode({ id: ONLINE_NODE_ID, name: 'rig-01' })),
          },
        },
      ],
    }).compile();

    modelAdminService = moduleRef.get(ModelAdminService);
  });

  describe('getModelList', () => {
    it('turns the requested page into an offset and a limit', async () => {
      await modelAdminService.getModelList({}, 3);

      expect(modelService.findAndCount).toHaveBeenCalledWith(expect.anything(), PAGE_SIZE * 2, PAGE_SIZE);
    });

    it('carries the display name beside the scanned name', async () => {
      modelService.findAndCount.mockResolvedValue([[buildModel({ displayName: 'Llama chat', availability: [] })], 1]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].name).toBe('Llama 3 8B');
      expect(response.modelList[0].displayName).toBe('Llama chat');
    });

    it('reports how many pages the catalogue holds', async () => {
      modelService.findAndCount.mockResolvedValue([[buildModel({ availability: [] })], 11]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.pages).toBe(3);
    });

    it('reads a model an online node holds as available', async () => {
      modelService.findAndCount.mockResolvedValue([
        [buildModel({ availability: [buildAvailability({ nodeId: ONLINE_NODE_ID, node: onlineNode() })] })],
        1,
      ]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].state).toBe(ModelState.AVAILABLE);
    });

    it('reads a model held only by offline nodes as unavailable, keeping its entries', async () => {
      modelService.findAndCount.mockResolvedValue([
        [buildModel({ availability: [buildAvailability({ nodeId: OFFLINE_NODE_ID, node: offlineNode() })] })],
        1,
      ]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].state).toBe(ModelState.UNAVAILABLE);
      expect(response.modelList[0].availability).toHaveLength(1);
      expect(response.modelList[0].availability[0].nodeState).toBe(NodeState.OFFLINE);
    });

    it('reads a model no node holds any more as unavailable with no entries', async () => {
      modelService.findAndCount.mockResolvedValue([[buildModel({ availability: [] })], 1]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].state).toBe(ModelState.UNAVAILABLE);
      expect(response.modelList[0].availability).toHaveLength(0);
    });

    it('carries the type the catalogue holds for each file', async () => {
      modelService.findAndCount.mockResolvedValue([[buildModel({ availability: [], type: ModelType.PROJECTOR })], 1]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].type).toBe(ModelType.PROJECTOR);
    });

    it("carries an admin's tasks over the scans', and none where they are unknown", async () => {
      modelService.findAndCount.mockResolvedValue([
        [
          buildModel({ id: 1, availability: [], detectedTasks: [ModelTask.TRANSCRIPTION] }),
          buildModel({
            id: 2,
            availability: [],
            detectedTasks: [ModelTask.CHAT],
            assignedTasks: [ModelTask.CHAT, ModelTask.SPEECH],
          }),
          buildModel({ id: 3, availability: [] }),
        ],
        3,
      ]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList.map(model => model.tasks)).toEqual([
        [ModelTask.TRANSCRIPTION],
        [ModelTask.CHAT, ModelTask.SPEECH],
        [],
      ]);
    });

    it.each([
      ['cc-by-nc-4.0', LicenceTerms.NON_COMMERCIAL],
      ['other', LicenceTerms.CUSTOM],
      ['apache-2.0', null],
    ])('marks a %s licence as %s', async (id, terms) => {
      modelService.findAndCount.mockResolvedValue([
        [buildModel({ availability: [], licence: { id, name: null, link: null } })],
        1,
      ]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].licence).toEqual({ id, name: null, link: null, terms });
    });

    it('narrows to the tasks asked for, an unknown task reaching the catalogue as null', async () => {
      await modelAdminService.getModelList({ task: [ModelTask.SPEECH, UNKNOWN_MODEL_TASK] }, 1);

      expect(modelService.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ task: [ModelTask.SPEECH, null] }),
        0,
        PAGE_SIZE
      );
    });

    it('carries each node its own path to the model', async () => {
      modelService.findAndCount.mockResolvedValue([
        [
          buildModel({
            availability: [
              buildAvailability({ id: 1, nodeId: ONLINE_NODE_ID, node: onlineNode(), path: '/models/llama.gguf' }),
              buildAvailability({ id: 2, nodeId: OFFLINE_NODE_ID, node: offlineNode(), path: '/srv/llama.gguf' }),
            ],
          }),
        ],
        1,
      ]);

      const response = await modelAdminService.getModelList({}, 1);

      expect(response.modelList[0].availability.map(entry => entry.path)).toEqual([
        '/models/llama.gguf',
        '/srv/llama.gguf',
      ]);
    });
  });

  describe('getModel', () => {
    it("carries what a projector's encoders take in", async () => {
      modelService.findWithThrow.mockResolvedValue(
        buildModel({
          availability: [],
          type: ModelType.PROJECTOR,
          modalities: [ProjectorModality.VISION, ProjectorModality.AUDIO],
        })
      );

      const model = await modelAdminService.getModel(1);

      expect(model.modalities).toEqual([ProjectorModality.VISION, ProjectorModality.AUDIO]);
    });

    it("carries what the scans read beside an admin's tasks, and that an admin set them", async () => {
      modelService.findWithThrow.mockResolvedValue(
        buildModel({
          availability: [],
          detectedTasks: [ModelTask.CHAT],
          assignedTasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION],
        })
      );

      const model = await modelAdminService.getModel(1);

      expect(model).toMatchObject({
        tasks: [ModelTask.CHAT, ModelTask.TRANSCRIPTION],
        detectedTasks: [ModelTask.CHAT],
        tasksAssigned: true,
      });
    });

    it('answers with the format the catalogue holds', async () => {
      modelService.findWithThrow.mockResolvedValue(buildModel({ availability: [], format: ModelFormat.SAFETENSORS }));

      const model = await modelAdminService.getModel(1);

      expect(model.format).toBe(ModelFormat.SAFETENSORS);
    });

    it('carries the parsed metadata of the model format', async () => {
      modelService.findWithThrow.mockResolvedValue(
        buildModel({
          availability: [],
          ggufMetadata: {
            architecture: 'llama',
            quantisation: 'Q4_K',
            quantisationMixed: true,
            layerCount: 32,
            embeddingLength: 4096,
            headCount: 32,
            headCountKv: 8,
            contextLength: 8192,
          },
        })
      );

      const model = await modelAdminService.getModel(1);

      expect(model.ggufMetadata?.quantisation).toBe('Q4_K');
      expect(model.safetensorsMetadata).toBeNull();
    });
  });
  describe('getNodeModelInventory', () => {
    const heldAt = (path: string, name: string, displayName: string | null = null) =>
      buildAvailability({ path, model: buildModel({ name, displayName, availability: [] }) });

    it('answers with what the node last reported', async () => {
      modelService.findAvailabilityByNode.mockResolvedValue([heldAt('/srv/weights/llama.gguf', 'Llama')]);

      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models.map(model => model.name)).toEqual(['Llama']);
    });

    it('orders the models by name', async () => {
      modelService.findAvailabilityByNode.mockResolvedValue([
        heldAt('/srv/weights/a.gguf', 'Qwen'),
        heldAt('/srv/weights/b.gguf', 'Llama'),
      ]);

      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models.map(model => model.name)).toEqual(['Llama', 'Qwen']);
    });

    it('orders a model with a display name by that name, carrying both', async () => {
      modelService.findAvailabilityByNode.mockResolvedValue([
        heldAt('/srv/weights/a.gguf', 'Llama'),
        heldAt('/srv/weights/b.gguf', 'Qwen', 'Coder'),
      ]);

      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models.map(model => [model.name, model.displayName])).toEqual([
        ['Qwen', 'Coder'],
        ['Llama', null],
      ]);
    });

    it("carries this node's own path to each model", async () => {
      modelService.findAvailabilityByNode.mockResolvedValue([heldAt('/srv/weights/llama.gguf', 'Llama')]);

      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models[0].path).toBe('/srv/weights/llama.gguf');
    });

    it('carries the type of each file the node holds', async () => {
      modelService.findAvailabilityByNode.mockResolvedValue([
        buildAvailability({
          path: '/srv/weights/mmproj-F32.gguf',
          model: buildModel({ name: 'Llama', availability: [], type: ModelType.PROJECTOR }),
        }),
      ]);

      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models[0].type).toBe(ModelType.PROJECTOR);
    });

    it('answers with nothing for a node that has reported no models', async () => {
      const inventory = await modelAdminService.getNodeModelInventory(ONLINE_NODE_ID);

      expect(inventory.models).toEqual([]);
    });
  });

  describe('scanNodeModels', () => {
    it('asks the node to sweep the directories it is configured with', async () => {
      await modelAdminService.scanNodeModels(ONLINE_NODE_ID);

      expect(modelService.requestScan).toHaveBeenCalledWith(ONLINE_NODE_ID);
    });
  });
});
