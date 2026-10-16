import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelTask } from '@libs/agent-protocol';
import { BackendId, BackendOperation, ProjectorModality, StreamDialect } from '@libs/backends';
import { backendFor, IBackend } from '@libs/backends/runtime';
import { ActivationPolicy } from '@libs/dto';

import { Deployment } from '../deployment/entities/deployment.entity';

import { DeploymentService } from '../deployment/deployment.service';
import { ModelReferenceService } from '../model/model-reference.service';
import { DeploymentResolverService, ResolutionRefusal } from './deployment-resolver.service';

import { buildModel } from '@/test/model.factory';

vi.mock('@libs/backends/runtime', async importActual => {
  const actual = await importActual<typeof import('@libs/backends/runtime')>();

  return { ...actual, backendFor: vi.fn(actual.backendFor) };
});

const buildDeployment = (tasks: ModelTask[] = []): Deployment => {
  const deployment = new Deployment({
    name: 'chat-8b',
    modelId: 1,
    presetId: null,
    backend: BackendId.LLAMA_CPP,
    activationPolicy: ActivationPolicy.ON_DEMAND,
    description: null,
    schemaVersion: 1,
    document: '',
    configuration: {},
    configurationRevision: 'rev',
    appliedRevision: 'rev',
  });

  deployment.model = buildModel({ detectedTasks: tasks });

  return deployment;
};

describe('DeploymentResolverService', () => {
  let deploymentService: {
    findAll: ReturnType<typeof vi.fn>;
    findByName: ReturnType<typeof vi.fn>;
    getBackend: ReturnType<typeof vi.fn>;
    resolveConfiguration: ReturnType<typeof vi.fn>;
  };
  let modelReferenceService: { resolve: ReturnType<typeof vi.fn> };
  let deploymentResolverService: DeploymentResolverService;

  beforeEach(() => {
    vi.mocked(backendFor).mockReset();

    deploymentService = {
      findAll: vi.fn().mockResolvedValue([]),
      findByName: vi.fn().mockResolvedValue(buildDeployment()),
      getBackend: vi.fn().mockReturnValue(BackendId.LLAMA_CPP),
      resolveConfiguration: vi.fn().mockReturnValue({ configuration: {} }),
    };
    modelReferenceService = { resolve: vi.fn().mockResolvedValue([]) };

    deploymentResolverService = new DeploymentResolverService(
      deploymentService as unknown as DeploymentService,
      modelReferenceService as unknown as ModelReferenceService
    );
  });

  it('carries the backend, its capabilities and its mapping', async () => {
    const result = await deploymentResolverService.resolve('chat-8b', BackendOperation.CHAT_COMPLETIONS);

    expect(result.refusal).toBeNull();
    expect(result.resolved?.backend).toBe(BackendId.LLAMA_CPP);
    expect(result.resolved?.capability.path).toBe('/v1/chat/completions');
    expect(typeof result.resolved?.mapping.chatCompletions?.request).toBe('function');
  });

  it('finds every deployment whose backend serves the operation, and no other', async () => {
    const speaking = buildDeployment([ModelTask.SPEECH]);

    speaking.name = 'tts-1b';
    deploymentService.findAll.mockResolvedValue([buildDeployment(), speaking]);
    vi.mocked(backendFor)
      .mockReturnValueOnce({ definition: { operations: {} } } as unknown as IBackend)
      .mockReturnValueOnce({
        definition: { operations: { [BackendOperation.SPEECH]: { path: '/v1/audio/speech' } } },
      } as unknown as IBackend);

    const serving = await deploymentResolverService.findServing(BackendOperation.SPEECH);

    expect(serving.map(resolved => resolved.deployment.name)).toEqual(['tts-1b']);
  });

  it('finds a deployment of a model whose tasks are unknown for any operation its backend serves', async () => {
    deploymentService.findAll.mockResolvedValue([buildDeployment()]);
    vi.mocked(backendFor).mockReturnValueOnce({
      definition: { operations: { [BackendOperation.SPEECH]: { path: '/v1/audio/speech' } } },
    } as unknown as IBackend);

    const serving = await deploymentResolverService.findServing(BackendOperation.SPEECH);

    expect(serving.map(resolved => resolved.deployment.name)).toEqual(['chat-8b']);
  });

  it('refuses a name matching no deployment', async () => {
    deploymentService.findByName.mockResolvedValue(null);

    const result = await deploymentResolverService.resolve('nothing-here', BackendOperation.CHAT_COMPLETIONS);

    expect(result.resolved).toBeNull();
    expect(result.refusal).toBe(ResolutionRefusal.UNKNOWN_MODEL);
  });

  it('refuses an operation the resolved backend does not serve', async () => {
    vi.mocked(backendFor).mockReturnValue({
      definition: { operations: { [BackendOperation.CHAT_COMPLETIONS]: { path: '/v1/chat/completions' } } },
    } as unknown as IBackend);

    const result = await deploymentResolverService.resolve('chat-8b', BackendOperation.EMBEDDINGS);

    expect(result.resolved).toBeNull();
    expect(result.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
  });

  it('serves a model whose tasks are unknown every operation its backend serves', async () => {
    const result = await deploymentResolverService.resolve('chat-8b', BackendOperation.TRANSCRIPTION);

    expect(result.resolved?.capability.path).toBe('/v1/audio/transcriptions');
  });

  it('refuses embeddings to a chat model, though the backend serves them', async () => {
    deploymentService.findByName.mockResolvedValue(buildDeployment([ModelTask.CHAT]));

    const result = await deploymentResolverService.resolve('chat-8b', BackendOperation.EMBEDDINGS);

    expect(result.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
  });

  it("serves an admin's tasks over the ones the scans read", async () => {
    const deployment = buildDeployment([ModelTask.CHAT]);

    deployment.model = buildModel({ detectedTasks: [ModelTask.CHAT], assignedTasks: [ModelTask.EMBEDDING] });
    deploymentService.findByName.mockResolvedValue(deployment);

    const embeddings = await deploymentResolverService.resolve('chat-8b', BackendOperation.EMBEDDINGS);
    const chat = await deploymentResolverService.resolve('chat-8b', BackendOperation.CHAT_COMPLETIONS);

    expect(embeddings.refusal).toBeNull();
    expect(chat.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
  });

  it('refuses chat to a deployment whose model transcribes, though the backend serves chat', async () => {
    deploymentService.findByName.mockResolvedValue(buildDeployment([ModelTask.TRANSCRIPTION]));

    const result = await deploymentResolverService.resolve('whisper', BackendOperation.CHAT_COMPLETIONS);

    expect(result.resolved).toBeNull();
    expect(result.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
  });

  describe('a vLLM deployment of a transcription model', () => {
    beforeEach(() => {
      deploymentService.findByName.mockResolvedValue(buildDeployment([ModelTask.TRANSCRIPTION]));
      deploymentService.getBackend.mockReturnValue(BackendId.VLLM);
    });

    it('serves translation on its own path, refusing a stream and the subtitle formats vLLM cannot write', async () => {
      const result = await deploymentResolverService.resolve('whisper', BackendOperation.TRANSLATION);

      expect(result.resolved?.capability).toEqual({
        path: '/v1/audio/translations',
        responseFormats: ['json', 'text', 'verbose_json'],
        streaming: StreamDialect.NONE,
      });
    });

    it('refuses chat, which vLLM is not declared to serve', async () => {
      const result = await deploymentResolverService.resolve('whisper', BackendOperation.CHAT_COMPLETIONS);

      expect(result.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
    });
  });

  it('serves transcription from a chat model where the deployment names an audio projector', async () => {
    deploymentService.findByName.mockResolvedValue(buildDeployment([ModelTask.CHAT]));
    modelReferenceService.resolve.mockResolvedValue([
      { field: 'mmproj', model: buildModel({ modalities: [ProjectorModality.AUDIO] }) },
    ]);

    const result = await deploymentResolverService.resolve('asr-0.6b', BackendOperation.TRANSCRIPTION);

    expect(result.resolved?.capability.path).toBe('/v1/audio/transcriptions');
  });

  it('refuses transcription to a chat model where the deployment names only a vision projector', async () => {
    deploymentService.findByName.mockResolvedValue(buildDeployment([ModelTask.CHAT]));
    modelReferenceService.resolve.mockResolvedValue([
      { field: 'mmproj', model: buildModel({ modalities: [ProjectorModality.VISION] }) },
    ]);

    const result = await deploymentResolverService.resolve('vision-8b', BackendOperation.TRANSCRIPTION);

    expect(result.refusal).toBe(ResolutionRefusal.UNSUPPORTED_OPERATION);
  });
});
