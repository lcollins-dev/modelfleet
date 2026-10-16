import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelFormat, ModelType } from '@libs/agent-protocol';
import { BackendId, definitionFor } from '@libs/backends';
import { ConfigurationDocument, ConfigurationSource, NodeState } from '@libs/dto';

import { Availability } from '@/core/model/entities/availability.entity';
import { Model } from '@/core/model/entities/model.entity';

import { IEffectiveConfiguration } from '@/core/configuration/effective-configuration.service';
import { DeploymentService } from '@/core/deployment/deployment.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { InstanceLaunchService } from '@/core/instance/instance-launch.service';
import { ModelReferenceService } from '@/core/model/model-reference.service';
import { ModelService } from '@/core/model/model.service';
import { NodeService } from '@/core/node/node.service';

import { buildDeployment } from '@/test/deployment.factory';
import { buildInstance, TEST_DEVICE_KEY } from '@/test/instance.factory';
import { buildAvailability, buildModel } from '@/test/model.factory';
import { buildNode, TEST_NODE_ID } from '@/test/node.factory';

const LLAMA_CPP_IMAGES = definitionFor(BackendId.LLAMA_CPP).images;

const OTHER_DEVICE_KEY = 'GPU-99999999-9999-9999-9999-999999999999';
const OTHER_NODE_ID = 99;
const PROJECTOR_ID = 77;
const PROJECTOR_FINGERPRINT = 'b'.repeat(64);

const buildProjector = (overrides: Partial<Model> = {}) =>
  buildModel({
    id: PROJECTOR_ID,
    fingerprint: PROJECTOR_FINGERPRINT,
    type: ModelType.PROJECTOR,
    name: 'Gemma 3 4B',
    ...overrides,
  });

const effective = (configuration: ConfigurationDocument): IEffectiveConfiguration => ({
  backend: BackendId.LLAMA_CPP,
  entries: Object.entries(configuration).map(([key, value]) => ({
    key,
    value,
    source: ConfigurationSource.DEPLOYMENT,
    modelled: true,
  })),
  configuration,
});

const pinnedTo = (...devices: { nodeId: number; deviceKey: string }[]): ConfigurationDocument => ({
  image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
  contextSize: 8192,
  placement: { gpus: devices },
});

const withProjector = (): ConfigurationDocument => ({
  ...pinnedTo({ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }),
  mmproj: PROJECTOR_FINGERPRINT,
});

describe('InstanceLaunchService', () => {
  afterEach(() => {
    definitionFor(BackendId.LLAMA_CPP).images = LLAMA_CPP_IMAGES;
  });

  let deploymentService: {
    findWithThrow: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
    resolveConfiguration: ReturnType<typeof vi.fn>;
  };
  let gpuService: { findByNodeId: ReturnType<typeof vi.fn> };
  let modelService: {
    findAvailability: ReturnType<typeof vi.fn>;
    findByFingerprints: ReturnType<typeof vi.fn>;
  };
  let nodeService: {
    find: ReturnType<typeof vi.fn>;
    findWithThrow: ReturnType<typeof vi.fn>;
    getState: ReturnType<typeof vi.fn>;
  };
  let instanceLaunchService: InstanceLaunchService;

  /** Swapped per test, so a case can answer for the model and the projector differently. */
  let availabilityFor: (modelId: number, nodeId: number) => Availability | null;

  beforeEach(async () => {
    deploymentService = {
      findWithThrow: vi.fn(),
      getBackend: vi.fn().mockReturnValue(BackendId.LLAMA_CPP),
      resolveConfiguration: vi
        .fn()
        .mockReturnValue(effective(pinnedTo({ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }))),
    };

    gpuService = { findByNodeId: vi.fn().mockResolvedValue([{ deviceKey: TEST_DEVICE_KEY }]) };
    modelService = {
      findAvailability: vi.fn((modelId: number, nodeId: number) => Promise.resolve(availabilityFor(modelId, nodeId))),
      findByFingerprints: vi.fn(() => Promise.resolve(new Map<string, Model>())),
    };
    availabilityFor = () => buildAvailability();
    nodeService = {
      find: vi.fn().mockResolvedValue(buildNode()),
      findWithThrow: vi.fn().mockResolvedValue(buildNode()),
      getState: vi.fn().mockReturnValue(NodeState.ONLINE),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceLaunchService,
        ModelReferenceService,
        { provide: DeploymentService, useValue: deploymentService },
        { provide: GpuService, useValue: gpuService },
        { provide: ModelService, useValue: modelService },
        { provide: NodeService, useValue: nodeService },
      ],
    }).compile();

    instanceLaunchService = moduleRef.get(InstanceLaunchService);
  });

  describe('resolvePlacements', () => {
    it('takes the node and the devices from the pins, deciding nothing itself', async () => {
      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([
        { nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null },
      ]);
    });

    it('refuses a deployment that names no placement at all', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective({ image: 'llama:latest' }));

      await expect(instanceLaunchService.resolvePlacements(buildDeployment())).rejects.toThrow(BadRequestException);
    });

    it('places an instance pinning no device on the node it names, taking no devices', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({ image: 'llama:latest', placement: { nodeIds: [TEST_NODE_ID] } })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([{ nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null }]);
      expect(gpuService.findByNodeId).not.toHaveBeenCalled();
    });

    it('names a placement whose image variant the backend lacks, where the document names no image', async () => {
      definitionFor(BackendId.LLAMA_CPP).images = { cuda: 'engine:cuda' };
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          image: null,
          placement: { nodeIds: [TEST_NODE_ID], gpus: [{ nodeId: OTHER_NODE_ID, deviceKey: OTHER_DEVICE_KEY }] },
        })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements.map(placement => placement.problem)).toEqual([
        'Set a container image, since this backend has no image for cpu placements',
        expect.not.stringContaining('image'),
      ]);
    });

    it('places a CPU-only instance on a backend lacking the variant where the document names an image', async () => {
      definitionFor(BackendId.LLAMA_CPP).images = { cuda: 'engine:cuda' };
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({ image: 'engine:cpu', placement: { nodeIds: [TEST_NODE_ID] } })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements[0].problem).toBeNull();
    });

    it('gives every node it names an instance of its own, on the CPU', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({ image: 'llama:latest', placement: { nodeIds: [TEST_NODE_ID, OTHER_NODE_ID] } })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([
        { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null },
        { nodeId: OTHER_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null },
      ]);
    });

    it('groups pins by node, so each node takes the whole set pinned on it', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective(
          pinnedTo(
            { nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY },
            { nodeId: TEST_NODE_ID, deviceKey: OTHER_DEVICE_KEY },
            { nodeId: OTHER_NODE_ID, deviceKey: TEST_DEVICE_KEY }
          )
        )
      );
      gpuService.findByNodeId.mockResolvedValue([{ deviceKey: TEST_DEVICE_KEY }, { deviceKey: OTHER_DEVICE_KEY }]);

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([
        { nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY, OTHER_DEVICE_KEY] }, problem: null },
        { nodeId: OTHER_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null },
      ]);
    });

    it('carries a node pinning several cards to a backend that runs on one, leaving a single pin startable', async () => {
      deploymentService.getBackend.mockReturnValue(BackendId.WHISPER_CPP);
      deploymentService.resolveConfiguration.mockReturnValue(
        effective(
          pinnedTo(
            { nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY },
            { nodeId: TEST_NODE_ID, deviceKey: OTHER_DEVICE_KEY },
            { nodeId: OTHER_NODE_ID, deviceKey: TEST_DEVICE_KEY }
          )
        )
      );
      gpuService.findByNodeId.mockResolvedValue([{ deviceKey: TEST_DEVICE_KEY }, { deviceKey: OTHER_DEVICE_KEY }]);

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements.map(placement => placement.problem)).toEqual([
        'Choose one GPU on this node, since this backend runs on a single GPU',
        null,
      ]);
    });

    it('carries a node pinning its CPU beside a card to a backend that cannot offload, saved before it was refused', async () => {
      deploymentService.getBackend.mockReturnValue(BackendId.KOKORO);
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          image: 'kokoro:latest',
          placement: { nodeIds: [TEST_NODE_ID], gpus: [{ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }] },
        })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements[0].problem).toBe(
        "Choose this node's CPU or its GPUs, not both, since this backend cannot offload to host memory"
      );
    });

    it('carries a CPU node beside a pinned one, which are two instances rather than a conflict', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          image: 'llama:latest',
          placement: { nodeIds: [OTHER_NODE_ID], gpus: [{ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }] },
        })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([
        { nodeId: TEST_NODE_ID, pins: { cpu: false, gpus: [TEST_DEVICE_KEY] }, problem: null },
        { nodeId: OTHER_NODE_ID, pins: { cpu: true, gpus: [] }, problem: null },
      ]);
    });

    it('puts one node holding both its CPU and its GPUs on those GPUs, offloading to the host', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          image: 'llama:latest',
          placement: { nodeIds: [TEST_NODE_ID], gpus: [{ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }] },
        })
      );

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements).toEqual([
        { nodeId: TEST_NODE_ID, pins: { cpu: true, gpus: [TEST_DEVICE_KEY] }, problem: null },
      ]);
    });

    it('carries a node fault on that node alone, leaving the others startable', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({ image: 'llama:latest', placement: { nodeIds: [TEST_NODE_ID, OTHER_NODE_ID] } })
      );
      availabilityFor = (_modelId, nodeId) => (nodeId === OTHER_NODE_ID ? null : buildAvailability());

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements[0].problem).toBeNull();
      expect(placements[1].problem).toMatch(/does not hold/);
    });

    it('carries a device the node has never reported', async () => {
      gpuService.findByNodeId.mockResolvedValue([{ deviceKey: OTHER_DEVICE_KEY }]);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toContain(TEST_DEVICE_KEY);
    });

    it('carries a node whose agent has never made contact', async () => {
      nodeService.getState.mockReturnValue(NodeState.REGISTERED);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/never made contact/);
    });

    it('carries a node that is offline, since nothing would create the container', async () => {
      nodeService.getState.mockReturnValue(NodeState.OFFLINE);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/is offline/);
    });

    it('carries a node that is disabled', async () => {
      nodeService.getState.mockReturnValue(NodeState.DISABLED);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/is disabled/);
    });

    it('carries a node that has been deleted, rather than refusing every other node with it', async () => {
      nodeService.find.mockResolvedValue(null);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/no longer exists/);
    });

    it('carries a node that does not hold the model', async () => {
      availabilityFor = () => null;

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/does not hold/);
    });

    it('carries a deployment whose file a later scan re-typed, which no write guard can catch', async () => {
      const deployment = buildDeployment({ model: buildModel({ type: ModelType.PROJECTOR }) });

      const [placement] = await instanceLaunchService.resolvePlacements(deployment);

      expect(placement.problem).toMatch(/multimodal projector/);
    });

    it('carries a deployment whose model a rescan gave an architecture with no stages listed', async () => {
      const model = buildModel({
        format: ModelFormat.SAFETENSORS,
        safetensorsMetadata: { dtype: 'BF16', tensorCount: 1, parameterCount: 1, architecture: 'qwen2_5_omni' },
      });

      deploymentService.getBackend.mockReturnValue(BackendId.VLLM_OMNI);

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment({ model }));

      expect(placement.problem).toMatch(/qwen2_5_omni architecture/);
    });

    it('carries a node holding the model but not the projector, naming the file it is short of', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));
      availabilityFor = modelId => (modelId === PROJECTOR_ID ? null : buildAvailability());

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toBe(
        'This node does not hold Gemma 3 4B, the multimodal projector this deployment uses'
      );
    });

    it('names the missing projector by its scanned name, never its display name', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(
        new Map([[PROJECTOR_FINGERPRINT, buildProjector({ displayName: 'Vision' })]])
      );
      availabilityFor = modelId => (modelId === PROJECTOR_ID ? null : buildAvailability());

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/does not hold Gemma 3 4B,/);
    });

    it('lets a node holding both the model and the projector start', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toBeNull();
    });

    it('carries a projector deleted from the catalogue after the deployment was saved', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toMatch(/not in the catalogue/);
    });

    it('carries a projector a later scan re-typed, which no write guard can catch', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(
        new Map([[PROJECTOR_FINGERPRINT, buildProjector({ type: ModelType.LORA })]])
      );

      const [placement] = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placement.problem).toBe('Gemma 3 4B is a LoRA adapter, and Projector takes a multimodal projector');
    });

    it('holds a missing projector against the node short of it alone, leaving the others startable', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          ...withProjector(),
          placement: { nodeIds: [TEST_NODE_ID, OTHER_NODE_ID] },
        })
      );
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));
      availabilityFor = (modelId, nodeId) =>
        modelId === PROJECTOR_ID && nodeId === OTHER_NODE_ID ? null : buildAvailability();

      const placements = await instanceLaunchService.resolvePlacements(buildDeployment());

      expect(placements[0].problem).toBeNull();
      expect(placements[1].problem).toBe(
        'This node does not hold Gemma 3 4B, the multimodal projector this deployment uses'
      );
    });
  });

  describe('replicasOf', () => {
    it('is one where the deployment names none', () => {
      expect(instanceLaunchService.replicasOf(buildDeployment())).toBe(1);
    });

    it('is what the deployment names, per node rather than across the fleet', () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({ image: 'llama:latest', replicas: 3, placement: { nodeIds: [TEST_NODE_ID] } })
      );

      expect(instanceLaunchService.replicasOf(buildDeployment())).toBe(3);
    });
  });

  describe('describe', () => {
    it("carries the backend's configuration, the node's weights path and the instance's own devices", async () => {
      const deployment = buildDeployment({ model: buildModel() });

      const desired = await instanceLaunchService.describe(buildInstance(), deployment);

      expect(desired).toMatchObject({
        backend: BackendId.LLAMA_CPP,
        servedModel: 'llama-chat',
        weightsPath: '/models/llama-3-8b.gguf',
        configuration: { contextSize: 8192 },
        image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
      });
    });

    it("takes the pins from the instance's own row, not from the deployment's current placement", async () => {
      const pins = { cpu: true, gpus: [TEST_DEVICE_KEY] };

      const desired = await instanceLaunchService.describe(
        buildInstance({ pins }),
        buildDeployment({ model: buildModel() })
      );

      expect(desired.pins).toEqual(pins);
    });

    it("resolves each companion's fingerprint to that node's own path", async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));
      availabilityFor = modelId =>
        modelId === PROJECTOR_ID
          ? buildAvailability({ modelId, path: '/models/gemma-3-4b/mmproj-F16.gguf' })
          : buildAvailability();

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.companionPaths).toEqual([{ field: 'mmproj', path: '/models/gemma-3-4b/mmproj-F16.gguf' }]);
      expect(desired.configuration).toHaveProperty('mmproj', PROJECTOR_FINGERPRINT);
    });

    it('describes an instance whose file a later scan re-typed, so a running container is not torn down', async () => {
      const deployment = buildDeployment({ model: buildModel({ type: ModelType.PROJECTOR }) });

      const desired = await instanceLaunchService.describe(buildInstance(), deployment);

      expect(desired.weightsPath).toBe('/models/llama-3-8b.gguf');
    });

    it('carries no companion paths where the deployment names none', async () => {
      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.companionPaths).toBeUndefined();
    });

    it('refuses to launch where the node has lost the companion since placement', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective(withProjector()));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, buildProjector()]]));
      availabilityFor = modelId => (modelId === PROJECTOR_ID ? null : buildAvailability());

      await expect(
        instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }))
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('leaves the fleet keys out of what the backend is configured with', async () => {
      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.configuration).not.toHaveProperty('replicas');
      expect(desired.configuration).not.toHaveProperty('placement');
    });

    it('reads the image out of the declared keys, which carry it through as a field holding no flag', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective({ image: 'llama:latest', contextSize: 8192 }));

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.image).toBe('llama:latest');
      expect(desired.configuration).toHaveProperty('image', 'llama:latest');
    });

    it("carries the model's size and its parsed metadata, so the agent opens no model file", async () => {
      const model = buildModel({
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
      });

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model }));

      expect(desired.model).toEqual({
        sizeBytes: model.sizeBytes,
        architecture: 'llama',
        quantisation: 'Q4_K',
        layerCount: 32,
        embeddingLength: 4096,
        headCount: 32,
        headCountKv: 8,
        contextLength: 8192,
      });
    });

    it("carries a safetensors model's config model type as its architecture, which picks its stages", async () => {
      const model = buildModel({
        format: ModelFormat.SAFETENSORS,
        safetensorsMetadata: {
          dtype: 'BF16',
          tensorCount: 400,
          parameterCount: 600_000_000,
          architecture: 'qwen3_tts',
        },
      });

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model }));

      expect(desired.model.architecture).toBe('qwen3_tts');
    });

    it('carries the reference as written, so a registry host and port reach the node intact', async () => {
      deploymentService.resolveConfiguration.mockReturnValue(
        effective({
          ...pinnedTo({ nodeId: TEST_NODE_ID, deviceKey: TEST_DEVICE_KEY }),
          image: 'registry.example.com:5000/llama',
        })
      );

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.image).toBe('registry.example.com:5000/llama');
    });

    it("names the backend's declared image where the document holds none", async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective({ contextSize: 8192 }));

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.image).toBe('ghcr.io/ggml-org/llama.cpp:server-cuda');
    });

    it("names the definition's image for the placement where the document sets the key to null", async () => {
      deploymentService.resolveConfiguration.mockReturnValue(effective({ contextSize: 8192, image: null }));

      const desired = await instanceLaunchService.describe(buildInstance(), buildDeployment({ model: buildModel() }));

      expect(desired.image).toBe('ghcr.io/ggml-org/llama.cpp:server-cuda');
    });

    it('names the CPU image for a CPU-only instance of a backend whose variants differ', async () => {
      definitionFor(BackendId.LLAMA_CPP).images = { cuda: 'engine:cuda', cpu: 'engine:cpu' };
      deploymentService.resolveConfiguration.mockReturnValue(effective({ contextSize: 8192, image: null }));

      const desired = await instanceLaunchService.describe(
        buildInstance({ pins: { cpu: true, gpus: [] } }),
        buildDeployment({ model: buildModel() })
      );

      expect(desired.image).toBe('engine:cpu');
    });
  });
});
