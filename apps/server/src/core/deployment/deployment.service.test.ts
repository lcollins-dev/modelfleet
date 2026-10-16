import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { ModelFormat, ModelType } from '@libs/agent-protocol';
import { BackendId } from '@libs/backends';
import {
  ActivationPolicy,
  ConfigurationDocument,
  ConfigurationSource,
  EventPartyType,
  EventSeverity,
  EventType,
} from '@libs/dto';

import { Deployment } from '@/core/deployment/entities/deployment.entity';

import { ConfigurationRevisionService } from '@/core/configuration/configuration-revision.service';
import { ConfigurationValueService } from '@/core/configuration/configuration-value.service';
import { ConfigurationService } from '@/core/configuration/configuration.service';
import {
  EffectiveConfigurationService,
  IEffectiveConfiguration,
  IEffectiveConfigurationEntry,
} from '@/core/configuration/effective-configuration.service';
import { DeploymentService, IDeploymentDefinition } from '@/core/deployment/deployment.service';
import { EventService } from '@/core/event/event.service';
import { ModelReferenceService } from '@/core/model/model-reference.service';
import { ModelService } from '@/core/model/model.service';
import { PresetService } from '@/core/preset/preset.service';

import { ModelUsageRegistry } from '@/core/model/model-usage.registry';
import { PresetReferenceRegistry } from '@/core/preset/preset-reference.registry';
import { buildDeployment, TEST_DEPLOYMENT_ID as DEPLOYMENT_ID, TEST_REVISION } from '@/test/deployment.factory';
import { buildModel, TEST_MODEL_ID as MODEL_ID } from '@/test/model.factory';
import { buildPreset, TEST_PRESET_ID as PRESET_ID } from '@/test/preset.factory';
import { issuePathsFrom } from '@/test/validation';

vi.mock('typeorm-transactional', () => {
  const transactionalDecorator = () => () => undefined;
  return { Transactional: transactionalDecorator };
});

const ACTOR_ID = 7;
const OTHER_MODEL_ID = MODEL_ID + 1;
const PROJECTOR_ID = 77;
const PROJECTOR_FINGERPRINT = 'b'.repeat(64);

const withProjector = { threads: 8, mmproj: PROJECTOR_FINGERPRINT };

const documentEntries = (resolved: IEffectiveConfiguration): IEffectiveConfigurationEntry[] =>
  resolved.entries.filter(entry => entry.source !== ConfigurationSource.DECLARATION);

interface IWrittenRevisions {
  configurationRevision: string;
  appliedRevision?: string;
}

const definition = (overrides: Partial<IDeploymentDefinition> = {}): IDeploymentDefinition => ({
  name: 'llama-chat',
  modelId: MODEL_ID,
  presetId: PRESET_ID,
  backend: null,
  activationPolicy: ActivationPolicy.ALWAYS,
  description: '',
  document: 'threads: 8\n',
  ...overrides,
});

describe('DeploymentService', () => {
  /** `find` is typed, so a test can answer the served lookup and the fingerprint scan differently. */
  let deploymentRepository: {
    findOne: ReturnType<typeof vi.fn>;
    find: Mock<(options?: { where?: { modelId?: number; presetId?: number } }) => Promise<Deployment[]>>;
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
  let presetService: { findWithThrow: ReturnType<typeof vi.fn> };
  let modelUsageRegistry: ModelUsageRegistry;
  let presetReferenceRegistry: PresetReferenceRegistry;
  let effectiveConfigurationService: EffectiveConfigurationService;
  let deploymentService: DeploymentService;
  let nameTaken: boolean;
  let rawPresetCounts: { presetId: number; deployments: number }[];
  let outOfDate: Deployment[];

  beforeEach(async () => {
    nameTaken = false;
    rawPresetCounts = [];
    outOfDate = [];

    deploymentRepository = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => Promise.resolve<Deployment[]>([])),
      insert: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getExists: vi.fn(() => Promise.resolve(nameTaken)),
        getRawMany: vi.fn(() => Promise.resolve(rawPresetCounts)),
        getMany: vi.fn(() => Promise.resolve(outOfDate)),
        getCount: vi.fn(() => Promise.resolve(outOfDate.length)),
      })),
    };

    eventService = { recordEvent: vi.fn().mockResolvedValue(undefined) };
    modelService = {
      findWithThrow: vi.fn(() => Promise.resolve(buildModel())),
      findByFingerprints: vi.fn(() => Promise.resolve(new Map())),
    };
    presetService = { findWithThrow: vi.fn(() => Promise.resolve(buildPreset())) };
    modelUsageRegistry = new ModelUsageRegistry();
    presetReferenceRegistry = new PresetReferenceRegistry();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DeploymentService,
        ConfigurationRevisionService,
        ConfigurationService,
        ConfigurationValueService,
        EffectiveConfigurationService,
        { provide: EventService, useValue: eventService },
        ModelReferenceService,
        { provide: ModelService, useValue: modelService },
        { provide: ModelUsageRegistry, useValue: modelUsageRegistry },
        { provide: PresetService, useValue: presetService },
        { provide: PresetReferenceRegistry, useValue: presetReferenceRegistry },
        { provide: getRepositoryToken(Deployment), useValue: deploymentRepository },
      ],
    }).compile();

    effectiveConfigurationService = moduleRef.get(EffectiveConfigurationService);
    deploymentService = moduleRef.get(DeploymentService);
    deploymentService.onModuleInit();
  });

  describe('create', () => {
    it('takes its backend from the preset it names and stores only its own keys', async () => {
      const deployment = await deploymentService.create(definition(), ACTOR_ID);

      expect(deployment.presetId).toBe(PRESET_ID);
      expect(deployment.backend).toBeNull();
      expect(deployment.document).toBe('threads: 8\n');
      expect(deployment.configuration).toEqual({ threads: 8 });
    });

    it('records the creation against the actor', async () => {
      await deploymentService.create(definition(), ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DEPLOYMENT_CREATED,
        expect.anything(),
        expect.objectContaining({ actorType: EventPartyType.USER, subjectType: EventPartyType.DEPLOYMENT })
      );
    });

    it('names the model it serves by its display name', async () => {
      modelService.findWithThrow.mockResolvedValue(buildModel({ displayName: 'Llama chat' }));

      await deploymentService.create(definition(), ACTOR_ID);

      const [, , options] = eventService.recordEvent.mock.calls[0] as [
        EventType,
        EventSeverity,
        { message: string; detail: { modelName: string } },
      ];

      expect(options.message).toBe('Created deployment **llama-chat** serving model **Llama chat**');
      expect(options.detail.modelName).toBe('Llama chat');
    });

    it('holds its configuration directly where it names no preset', async () => {
      const deployment = await deploymentService.create(
        definition({ presetId: null, backend: BackendId.LLAMA_CPP, document: 'image: llama:latest\n' }),
        ACTOR_ID
      );

      expect(deployment.presetId).toBeNull();
      expect(deployment.backend).toBe(BackendId.LLAMA_CPP);
    });

    it('refuses a deployment naming neither a preset nor a backend', async () => {
      await expect(deploymentService.create(definition({ presetId: null }), ACTOR_ID)).rejects.toThrow(
        'Choose a backend when the deployment does not use a preset'
      );
    });

    it('refuses a deployment naming a backend beside a preset', async () => {
      await expect(deploymentService.create(definition({ backend: BackendId.LLAMA_CPP }), ACTOR_ID)).rejects.toThrow(
        'A deployment that uses a preset must use the backend from that preset'
      );
    });

    it('lets a deployment standing alone name no image, leaving the backend its tested one', async () => {
      const deployment = await deploymentService.create(
        definition({ presetId: null, backend: BackendId.LLAMA_CPP, document: 'threads: 8\n' }),
        ACTOR_ID
      );

      expect(deployment.configuration).toEqual({ threads: 8 });
    });

    it('refuses a name another deployment already holds', async () => {
      nameTaken = true;

      await expect(deploymentService.create(definition(), ACTOR_ID)).rejects.toThrow('already exists');

      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });
  });

  describe('draft', () => {
    it('builds the deployment create would store, on the same revision, and writes nothing', async () => {
      const drafted = await deploymentService.draft(definition());

      expect(deploymentRepository.insert).not.toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();

      const created = await deploymentService.create(definition(), ACTOR_ID);

      expect(drafted.configuration).toEqual(created.configuration);
      expect(drafted.configurationRevision).toBe(created.configurationRevision);
    });

    it('carries its model and preset, which sizing and placing it read', async () => {
      const drafted = await deploymentService.draft(definition());

      expect(drafted.model).toEqual(buildModel());
      expect(drafted.preset).toEqual(buildPreset());
    });

    it('refuses a draft naming neither a preset nor a backend, as create does', async () => {
      await expect(deploymentService.draft(definition({ presetId: null }))).rejects.toThrow(
        'Choose a backend when the deployment does not use a preset'
      );
    });
  });

  describe('the companion a deployment names', () => {
    const document = `threads: 8\nmmproj: ${PROJECTOR_FINGERPRINT}\n`;

    it('refuses a fingerprint the catalogue does not hold', async () => {
      modelService.findByFingerprints.mockResolvedValue(new Map());

      await expect(deploymentService.create(definition({ document }), ACTOR_ID)).rejects.toThrow(
        'not in the catalogue'
      );
      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });

    it('refuses a fingerprint naming a file of the wrong type, saying what each is', async () => {
      const model = buildModel({ id: PROJECTOR_ID, fingerprint: PROJECTOR_FINGERPRINT, type: ModelType.LORA });

      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, model]]));

      await expect(deploymentService.create(definition({ document }), ACTOR_ID)).rejects.toThrow(
        'is a LoRA adapter, and Projector takes a multimodal projector'
      );
      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });

    it('names a file of the wrong type by its display name', async () => {
      const model = buildModel({
        id: PROJECTOR_ID,
        fingerprint: PROJECTOR_FINGERPRINT,
        type: ModelType.LORA,
        displayName: 'Gemma style',
      });

      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, model]]));

      await expect(deploymentService.create(definition({ document }), ACTOR_ID)).rejects.toThrow(
        'Gemma style is a LoRA adapter'
      );
    });

    it('refuses an update that moves onto a fingerprint the catalogue does not hold', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      modelService.findByFingerprints.mockResolvedValue(new Map());

      await expect(deploymentService.update(DEPLOYMENT_ID, definition({ document }), ACTOR_ID)).rejects.toThrow(
        'not in the catalogue'
      );
      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });

    it('lets an edit through where the projector it already named was re-typed by a later scan', async () => {
      const retyped = buildModel({ id: PROJECTOR_ID, fingerprint: PROJECTOR_FINGERPRINT, type: ModelType.LORA });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ configuration: withProjector }));
      modelService.findByFingerprints.mockResolvedValue(new Map([[PROJECTOR_FINGERPRINT, retyped]]));

      await deploymentService.update(DEPLOYMENT_ID, definition({ document }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalled();
    });

    it('lets a deployment inherit a companion its preset already named, since its own form cannot fix it', async () => {
      presetService.findWithThrow.mockResolvedValue(buildPreset({ configuration: withProjector }));
      modelService.findByFingerprints.mockResolvedValue(new Map());

      await deploymentService.create(definition(), ACTOR_ID);

      expect(deploymentRepository.insert).toHaveBeenCalled();
    });
  });

  describe('the files a deployment may serve', () => {
    const cases: [ModelType, string][] = [
      [ModelType.PROJECTOR, 'multimodal projector'],
      [ModelType.LORA, 'LoRA adapter'],
      [ModelType.CONTROL_VECTOR, 'control vector'],
    ];

    it.each(cases)('refuses a deployment created against a %s, naming what the file is', async (type, named) => {
      modelService.findWithThrow.mockResolvedValue(buildModel({ type }));

      await expect(deploymentService.create(definition(), ACTOR_ID)).rejects.toThrow(named);
      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });

    it.each(cases)('refuses a deployment moved onto a %s, naming what the file is', async (type, named) => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      modelService.findWithThrow.mockResolvedValue(buildModel({ id: OTHER_MODEL_ID, type }));

      await expect(
        deploymentService.update(DEPLOYMENT_ID, definition({ modelId: OTHER_MODEL_ID }), ACTOR_ID)
      ).rejects.toThrow(named);
      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a deployment created against a model in a format its backend does not load, naming both', async () => {
      modelService.findWithThrow.mockResolvedValue(buildModel({ name: 'whisper', format: ModelFormat.SAFETENSORS }));

      await expect(deploymentService.create(definition(), ACTOR_ID)).rejects.toThrow(
        'whisper is a safetensors model, and llama.cpp loads GGUF alone'
      );
      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });

    it('refuses a deployment moved onto a model in a format its backend does not load', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      modelService.findWithThrow.mockResolvedValue(buildModel({ id: OTHER_MODEL_ID, format: ModelFormat.SAFETENSORS }));

      await expect(
        deploymentService.update(DEPLOYMENT_ID, definition({ modelId: OTHER_MODEL_ID }), ACTOR_ID)
      ).rejects.toThrow('safetensors');
      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });

    it('refuses a deployment of a model whose architecture its backend lists no single-card pipeline for, naming it', async () => {
      presetService.findWithThrow.mockResolvedValue(buildPreset({ backend: BackendId.VLLM_OMNI, configuration: {} }));
      modelService.findWithThrow.mockResolvedValue(
        buildModel({
          name: 'Qwen2.5-Omni-7B',
          format: ModelFormat.SAFETENSORS,
          safetensorsMetadata: { dtype: 'BF16', tensorCount: 1, parameterCount: 1, architecture: 'qwen2_5_omni' },
        })
      );

      await expect(deploymentService.create(definition({ document: '' }), ACTOR_ID)).rejects.toThrow(
        'Qwen2.5-Omni-7B has the qwen2_5_omni architecture, which vllm-omni lists no single-card pipeline for'
      );
      expect(deploymentRepository.insert).not.toHaveBeenCalled();
    });

    it('takes a deployment of a model whose architecture its backend lists stages for', async () => {
      presetService.findWithThrow.mockResolvedValue(buildPreset({ backend: BackendId.VLLM_OMNI, configuration: {} }));
      modelService.findWithThrow.mockResolvedValue(
        buildModel({
          format: ModelFormat.SAFETENSORS,
          safetensorsMetadata: { dtype: 'BF16', tensorCount: 1, parameterCount: 1, architecture: 'qwen3_tts' },
        })
      );

      await deploymentService.create(definition({ document: '' }), ACTOR_ID);

      expect(deploymentRepository.insert).toHaveBeenCalled();
    });

    it('refuses a deployment moved onto a backend that lists no stages for its model', async () => {
      const model = buildModel({ format: ModelFormat.SAFETENSORS });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model }));
      modelService.findWithThrow.mockResolvedValue(model);

      await expect(
        deploymentService.update(
          DEPLOYMENT_ID,
          definition({ presetId: null, backend: BackendId.VLLM_OMNI, document: '' }),
          ACTOR_ID
        )
      ).rejects.toThrow('has no architecture');
      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });

    it('lets a deployment created before stages were checked be edited without moving it', async () => {
      const model = buildModel({ format: ModelFormat.SAFETENSORS });
      const preset = buildPreset({ backend: BackendId.VLLM_OMNI, configuration: {} });

      presetService.findWithThrow.mockResolvedValue(preset);
      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model, preset }));
      modelService.findWithThrow.mockResolvedValue(model);

      await deploymentService.update(DEPLOYMENT_ID, definition({ name: 'renamed', document: '' }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalled();
    });

    it('lets a deployment created before formats were checked be edited without moving it', async () => {
      const model = buildModel({ format: ModelFormat.SAFETENSORS });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model }));
      modelService.findWithThrow.mockResolvedValue(model);

      await deploymentService.update(DEPLOYMENT_ID, definition({ name: 'renamed' }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalled();
    });

    it('refuses a deployment moved onto a backend that does not load its model, keeping the model', async () => {
      const model = buildModel({ name: 'llama-3-8b', format: ModelFormat.GGUF });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model }));
      modelService.findWithThrow.mockResolvedValue(model);

      await expect(
        deploymentService.update(
          DEPLOYMENT_ID,
          definition({ presetId: null, backend: BackendId.VLLM, document: '' }),
          ACTOR_ID
        )
      ).rejects.toThrow('llama-3-8b is a GGUF model, and vllm loads safetensors alone');
      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });

    it('lets a deployment moved onto a backend that loads its model be edited', async () => {
      const model = buildModel({ format: ModelFormat.SAFETENSORS });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model }));
      modelService.findWithThrow.mockResolvedValue(model);

      await deploymentService.update(
        DEPLOYMENT_ID,
        definition({ presetId: null, backend: BackendId.VLLM, document: '' }),
        ACTOR_ID
      );

      expect(deploymentRepository.update).toHaveBeenCalled();
    });

    it('lets a deployment already pointing at a re-typed file be edited without moving it', async () => {
      const model = buildModel({ type: ModelType.PROJECTOR });

      deploymentRepository.findOne.mockResolvedValue(buildDeployment({ model }));
      modelService.findWithThrow.mockResolvedValue(model);

      await deploymentService.update(DEPLOYMENT_ID, definition({ name: 'renamed' }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalled();
    });
  });

  describe('resolveConfiguration', () => {
    it('overlays the deployment on its preset, attributing each value to the layer it came from', () => {
      const resolved = deploymentService.resolveConfiguration(buildDeployment());

      expect(resolved.backend).toBe(BackendId.LLAMA_CPP);
      expect(resolved.configuration).toEqual({ image: 'llama:latest', threads: 8 });
      expect(documentEntries(resolved)).toEqual([
        { key: 'image', value: 'llama:latest', source: ConfigurationSource.PRESET, modelled: true },
        { key: 'threads', value: 8, source: ConfigurationSource.DEPLOYMENT, presetValue: 16, modelled: true },
      ]);
    });

    it("reports the backend's declared defaults beside the keys the documents set", () => {
      const resolved = deploymentService.resolveConfiguration(buildDeployment());
      const declared = resolved.entries.filter(entry => entry.source === ConfigurationSource.DECLARATION);

      expect(declared.map(entry => entry.key)).toEqual([
        'contextSize',
        'ubatchSize',
        'parallel',
        'cacheTypeK',
        'cacheTypeV',
        'jinja',
      ]);
    });

    it('attributes every value to a deployment naming no preset', () => {
      const deployment = buildDeployment({
        presetId: null,
        preset: undefined,
        backend: BackendId.LLAMA_CPP,
        configuration: { image: 'llama:latest', threads: 8 },
      });

      expect(documentEntries(deploymentService.resolveConfiguration(deployment)).map(entry => entry.source)).toEqual([
        ConfigurationSource.DEPLOYMENT,
        ConfigurationSource.DEPLOYMENT,
      ]);
    });
  });

  describe('previewPresetSwap', () => {
    beforeEach(() => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
    });

    it('names the preset the deployment would move to and what the swap would drop', async () => {
      vi.spyOn(effectiveConfigurationService, 'orphanedKeys').mockReturnValue(['threads']);

      await expect(
        deploymentService.previewPresetSwap(DEPLOYMENT_ID, {
          presetId: PRESET_ID,
          backend: null,
          document: 'threads: 8\n',
        })
      ).resolves.toEqual({ backend: BackendId.LLAMA_CPP, presetName: 'Single 4090', droppedKeys: ['threads'] });
    });

    it('drops nothing where the backend is unchanged', async () => {
      await expect(
        deploymentService.previewPresetSwap(DEPLOYMENT_ID, {
          presetId: PRESET_ID,
          backend: null,
          document: 'threads: 8\n',
        })
      ).resolves.toMatchObject({ droppedKeys: [] });
    });

    it('names no preset where the swap moves the deployment onto its own configuration', async () => {
      await expect(
        deploymentService.previewPresetSwap(DEPLOYMENT_ID, {
          presetId: null,
          backend: BackendId.LLAMA_CPP,
          document: 'image: llama:latest\n',
        })
      ).resolves.toMatchObject({ presetName: null });
    });
  });

  describe('update', () => {
    beforeEach(() => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
    });

    it('removes the overrides the new backend has no field for, comments around them intact', async () => {
      vi.spyOn(effectiveConfigurationService, 'orphanedKeys').mockReturnValue(['gpuLayers']);

      await deploymentService.update(
        DEPLOYMENT_ID,
        definition({ document: '# tuning\nthreads: 8\ngpuLayers: 99\n' }),
        ACTOR_ID
      );

      expect(deploymentRepository.update).toHaveBeenCalledWith(
        { id: DEPLOYMENT_ID },
        expect.objectContaining({ document: '# tuning\nthreads: 8\n', configuration: { threads: 8 } })
      );
    });

    it('carries every override across where the backend is unchanged', async () => {
      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 8\ngpuLayers: 99\n' }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalledWith(
        { id: DEPLOYMENT_ID },
        expect.objectContaining({ configuration: { threads: 8, gpuLayers: 99 } })
      );
    });

    it('announces the change once it is written, so the deployment supervisor reconciles it', async () => {
      const changed = vi.fn();

      deploymentService.deploymentChanged().subscribe(changed);

      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 8\n' }), ACTOR_ID);

      expect(changed).toHaveBeenCalledWith(DEPLOYMENT_ID);
    });

    it('clears the run of failed starts, so an edit is tried without waiting out the backoff', async () => {
      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 8\n' }), ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalledWith(expect.objectContaining({ id: DEPLOYMENT_ID }), {
        launchFailures: 0,
        lastLaunchFailureDate: null,
        lastLaunchFailure: null,
      });
    });
  });

  describe('setEnabled', () => {
    it('announces the change once it is written, so the deployment supervisor reconciles it', async () => {
      const changed = vi.fn();

      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      deploymentService.deploymentChanged().subscribe(changed);

      await deploymentService.setEnabled(DEPLOYMENT_ID, false, ACTOR_ID);

      expect(changed).toHaveBeenCalledWith(DEPLOYMENT_ID);
    });
  });

  describe('remove', () => {
    it("records the model it served by the model's display name", async () => {
      deploymentRepository.findOne.mockResolvedValue(
        buildDeployment({ model: buildModel({ displayName: 'Llama chat' }) })
      );

      await deploymentService.remove(DEPLOYMENT_ID, ACTOR_ID);

      const [type, , options] = eventService.recordEvent.mock.calls[0] as [
        EventType,
        EventSeverity,
        { detail: { modelName: string } },
      ];

      expect(type).toBe(EventType.DEPLOYMENT_DELETED);
      expect(options.detail.modelName).toBe('Llama chat');
    });
  });

  describe('countByPreset', () => {
    it('counts the deployments naming each preset', async () => {
      rawPresetCounts = [
        { presetId: PRESET_ID, deployments: 3 },
        { presetId: PRESET_ID + 1, deployments: 1 },
      ];

      await expect(deploymentService.countByPreset([PRESET_ID, PRESET_ID + 1])).resolves.toEqual(
        new Map([
          [PRESET_ID, 3],
          [PRESET_ID + 1, 1],
        ])
      );
    });

    it('leaves a preset no deployment names out of the map', async () => {
      await expect(deploymentService.countByPreset([PRESET_ID])).resolves.toEqual(new Map());
    });

    it('asks nothing of the database for an empty list', async () => {
      await expect(deploymentService.countByPreset([])).resolves.toEqual(new Map());

      expect(deploymentRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('findPresetImpact', () => {
    it('counts the deployments taking each changed key from the preset', async () => {
      deploymentRepository.find.mockResolvedValue([
        buildDeployment({ configuration: {} }),
        buildDeployment({ configuration: { threads: 4 } }),
      ]);

      await expect(deploymentService.findPresetImpact(PRESET_ID, 'image: llama:latest\nthreads: 8\n')).resolves.toEqual(
        {
          deployments: 2,
          affectedDeployments: 1,
          changedFields: [{ key: 'threads', inheritingDeployments: 1 }],
        }
      );
    });

    it('reports no changed field where the document matches the one the preset holds', async () => {
      deploymentRepository.find.mockResolvedValue([buildDeployment()]);

      await expect(
        deploymentService.findPresetImpact(PRESET_ID, 'image: llama:latest\nthreads: 16\n')
      ).resolves.toEqual({ deployments: 1, affectedDeployments: 0, changedFields: [] });
    });

    it('refuses a document the backend will not accept, so the count is never read off an invalid save', async () => {
      await expect(
        issuePathsFrom(() => deploymentService.findPresetImpact(PRESET_ID, 'threads: many\n'))
      ).resolves.toEqual(expect.arrayContaining(['threads']));
    });
  });

  describe('revisions', () => {
    const revisionPassedTo = (call: 'insert' | 'update'): IWrittenRevisions =>
      (call === 'insert'
        ? deploymentRepository.insert.mock.calls[0][0]
        : deploymentRepository.update.mock.calls[0][1]) as IWrittenRevisions;

    it('starts a new deployment on the revision it was created at', async () => {
      const deployment = await deploymentService.create(definition(), ACTOR_ID);

      expect(deployment.configurationRevision).toHaveLength(64);
      expect(deployment.appliedRevision).toBe(deployment.configurationRevision);
      expect(deploymentService.isOutOfDate(deployment)).toBe(false);
    });

    it('moves the revision when an edit changes a relaunch-required field', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      const before = (await deploymentService.create(definition(), ACTOR_ID)).configurationRevision;
      deploymentRepository.update.mockClear();

      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 4\n' }), ACTOR_ID);

      expect(revisionPassedTo('update').configurationRevision).not.toBe(before);
    });

    it('leaves the revision where it stands when an edit changes a hot field alone', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      const before = (await deploymentService.create(definition(), ACTOR_ID)).configurationRevision;
      deploymentRepository.update.mockClear();

      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 8\nreplicas: 4\n' }), ACTOR_ID);

      expect(revisionPassedTo('update').configurationRevision).toBe(before);
    });

    it('leaves the revision where it stands when only the name and the activation policy change', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());
      const before = (await deploymentService.create(definition(), ACTOR_ID)).configurationRevision;
      deploymentRepository.update.mockClear();

      await deploymentService.update(
        DEPLOYMENT_ID,
        definition({ name: 'llama-chat-v2', activationPolicy: ActivationPolicy.ON_DEMAND }),
        ACTOR_ID
      );

      expect(revisionPassedTo('update').configurationRevision).toBe(before);
    });

    it('leaves the applied revision alone on an edit, so the deployment reads as out of date', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());

      await deploymentService.update(DEPLOYMENT_ID, definition({ document: 'threads: 4\n' }), ACTOR_ID);

      expect(revisionPassedTo('update').appliedRevision).toBeUndefined();
    });
  });

  describe('onPresetConfigurationChanged', () => {
    const INHERITING_ID = 1;
    const OVERRIDING_ID = 2;

    /** Writes each settled revision back onto its deployment and clears the recorded update calls. */
    const settle = async (): Promise<Deployment[]> => {
      const deployments = [
        buildDeployment({ id: INHERITING_ID, configuration: {} }),
        buildDeployment({ id: OVERRIDING_ID, configuration: { flashAttn: 'on' } }),
      ];
      deploymentRepository.find.mockResolvedValue(deployments);

      await deploymentService.onPresetConfigurationChanged(PRESET_ID);

      const updates = deploymentRepository.update.mock.calls as [{ id: number }, IWrittenRevisions][];

      for (const [{ id }, { configurationRevision }] of updates) {
        const settled = deployments.find(deployment => deployment.id === id);
        if (settled) {
          settled.configurationRevision = configurationRevision;
        }
      }

      deploymentRepository.update.mockClear();

      return deployments;
    };

    const changePresetTo = (deployments: Deployment[], configuration: ConfigurationDocument): void => {
      for (const deployment of deployments) {
        deployment.preset = buildPreset({ configuration });
      }
    };

    it('moves the revision of a deployment inheriting the changed field', async () => {
      const deployments = await settle();
      changePresetTo(deployments, { image: 'llama:latest', threads: 16, flashAttn: 'off' });

      await deploymentService.onPresetConfigurationChanged(PRESET_ID);

      const [[{ id }, written]] = deploymentRepository.update.mock.calls as [{ id: number }, IWrittenRevisions][];

      expect(id).toBe(INHERITING_ID);
      expect(written.configurationRevision).toHaveLength(64);
    });

    it('leaves a deployment overriding the changed field where it stands', async () => {
      const deployments = await settle();
      changePresetTo(deployments, { image: 'llama:latest', threads: 16, flashAttn: 'off' });

      await deploymentService.onPresetConfigurationChanged(PRESET_ID);

      expect(deploymentRepository.update).not.toHaveBeenCalledWith({ id: OVERRIDING_ID }, expect.anything());
    });

    it('leaves every deployment where it stands when the preset moves a hot field alone', async () => {
      const deployments = await settle();
      changePresetTo(deployments, { image: 'llama:latest', threads: 16, replicas: 4 });

      await deploymentService.onPresetConfigurationChanged(PRESET_ID);

      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('brings the applied revision up to the current one', async () => {
      deploymentRepository.findOne.mockResolvedValue(
        buildDeployment({ configurationRevision: 'b'.repeat(64), appliedRevision: TEST_REVISION })
      );

      await deploymentService.apply(DEPLOYMENT_ID, ACTOR_ID);

      expect(deploymentRepository.update).toHaveBeenCalledWith(
        { id: DEPLOYMENT_ID },
        { appliedRevision: 'b'.repeat(64) }
      );
    });

    it('records the apply against the actor', async () => {
      deploymentRepository.findOne.mockResolvedValue(
        buildDeployment({ configurationRevision: 'b'.repeat(64), appliedRevision: TEST_REVISION })
      );

      await deploymentService.apply(DEPLOYMENT_ID, ACTOR_ID);

      expect(eventService.recordEvent).toHaveBeenCalledWith(
        EventType.DEPLOYMENT_APPLIED,
        expect.anything(),
        expect.objectContaining({ actorType: EventPartyType.USER, subjectType: EventPartyType.DEPLOYMENT })
      );
    });

    it('writes nothing for a deployment already up to date', async () => {
      deploymentRepository.findOne.mockResolvedValue(buildDeployment());

      await deploymentService.apply(DEPLOYMENT_ID, ACTOR_ID);

      expect(deploymentRepository.update).not.toHaveBeenCalled();
      expect(eventService.recordEvent).not.toHaveBeenCalled();
    });
  });

  describe('applyAll', () => {
    it('applies every out-of-date deployment and answers with how many moved', async () => {
      outOfDate = [
        buildDeployment({ id: 1, configurationRevision: 'b'.repeat(64) }),
        buildDeployment({ id: 2, configurationRevision: 'c'.repeat(64) }),
      ];

      await expect(deploymentService.applyAll(ACTOR_ID)).resolves.toBe(2);

      expect(deploymentRepository.update).toHaveBeenCalledWith({ id: 1 }, { appliedRevision: 'b'.repeat(64) });
      expect(deploymentRepository.update).toHaveBeenCalledWith({ id: 2 }, { appliedRevision: 'c'.repeat(64) });
    });

    it('applies nothing where the fleet is up to date', async () => {
      await expect(deploymentService.applyAll(ACTOR_ID)).resolves.toBe(0);

      expect(deploymentRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('countOutOfDate', () => {
    it('counts the deployments whose configuration has moved ahead of what was applied', async () => {
      outOfDate = [buildDeployment()];

      await expect(deploymentService.countOutOfDate()).resolves.toBe(1);
    });
  });

  describe('references', () => {
    /** The served lookup finds nothing, so only the fingerprint scan can name the deployment. */
    const holdsProjector = (deployment: Deployment) => {
      modelService.findWithThrow.mockResolvedValue(
        buildModel({ id: PROJECTOR_ID, fingerprint: PROJECTOR_FINGERPRINT, type: ModelType.PROJECTOR })
      );
      deploymentRepository.find.mockImplementation(options =>
        Promise.resolve(options?.where === undefined ? [deployment] : [])
      );
    };

    it('names the deployments that hold a model, so deleting it is refused', async () => {
      deploymentRepository.find.mockResolvedValue([buildDeployment()]);

      await expect(modelUsageRegistry.findUsage(MODEL_ID)).resolves.toEqual([
        { kind: 'deployment', name: 'llama-chat' },
      ]);
    });

    it('names a deployment holding the model only as a companion, so deleting the projector is refused', async () => {
      holdsProjector(buildDeployment({ configuration: withProjector }));

      await expect(modelUsageRegistry.findUsage(PROJECTOR_ID)).resolves.toEqual([
        { kind: 'deployment', name: 'llama-chat' },
      ]);
    });

    it('names no deployment for a projector none of them holds', async () => {
      holdsProjector(buildDeployment({ configuration: { threads: 8 } }));

      await expect(modelUsageRegistry.findUsage(PROJECTOR_ID)).resolves.toEqual([]);
    });

    it('names a deployment once where it both serves a model and references it as a companion', async () => {
      deploymentRepository.find.mockImplementation(() =>
        Promise.resolve([buildDeployment({ configuration: withProjector })])
      );
      modelService.findWithThrow.mockResolvedValue(
        buildModel({ fingerprint: PROJECTOR_FINGERPRINT, type: ModelType.PROJECTOR })
      );

      await expect(modelUsageRegistry.findUsage(MODEL_ID)).resolves.toEqual([
        { kind: 'deployment', name: 'llama-chat' },
      ]);
    });

    it('names the deployments that hold a preset, so deleting it is refused', async () => {
      deploymentRepository.find.mockResolvedValue([buildDeployment()]);

      await expect(presetReferenceRegistry.findReferences(PRESET_ID)).resolves.toEqual([
        { kind: 'deployment', name: 'llama-chat' },
      ]);
    });
  });

  describe('getBackend', () => {
    it('reads the backend from the preset where the deployment names one', () => {
      const deployment = new Deployment({
        name: 'llama-chat',
        modelId: MODEL_ID,
        presetId: PRESET_ID,
        backend: null,
        activationPolicy: ActivationPolicy.ALWAYS,
        description: null,
        schemaVersion: 1,
        document: '',
        configuration: {},
        configurationRevision: '',
        appliedRevision: '',
      });
      deployment.preset = buildPreset();

      expect(deploymentService.getBackend(deployment)).toBe(BackendId.LLAMA_CPP);
    });
  });
});
