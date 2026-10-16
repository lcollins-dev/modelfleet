import { Test } from '@nestjs/testing';
import Docker from 'dockerode';
import ms from 'ms';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceState } from '@libs/agent-protocol';
import { BackendId, Readiness, ProbeMethod } from '@libs/backends';
import { BACKEND_LABEL, INSTANCE_LABEL } from '@libs/backends/runtime';

import { ConfigService } from '@/config/config.service';
import { DockerUnavailableError } from '@/docker/api/errors';
import { ContainerService, IInstanceContainer } from '@/docker/container.service';
import { InstanceEndpointService } from '@/instance/instance-endpoint.service';
import { adoptionLabels, START_TIMEOUT_LABEL } from '@/instance/instance-labels';
import { InstanceRuntimeService } from '@/instance/instance-runtime.service';
import { launchTimeoutMs } from '@/instance/launch-timeout';
import { ReadinessService } from '@/instance/readiness.service';
import { ShardGrouperService } from '@/model/scan/shard-grouper.service';
import { buildDesiredInstance, TEST_DEVICE_KEY, TEST_INSTANCE_KEY } from '@/test/instance.factory';

const START_TIMEOUT_MS = 180_000;
const CONTAINER_ID = 'c0ffee';
const NETWORK = 'modelfleet-instances';
const CONTAINER_ADDRESS = '198.51.100.4';

const GPU_TOTALS = new Map<string, number>();

const SHARE_KEY = 'gpu_memory_utilization';

const SPLIT_DIR = '/srv/models/qwen';
const SPLIT_FIRST = 'qwen-Q4_K_M-00001-of-00003.gguf';
const SPLIT_SECOND = 'qwen-Q4_K_M-00002-of-00003.gguf';
const SPLIT_THIRD = 'qwen-Q4_K_M-00003-of-00003.gguf';

/** Swapped per test, so a case can resolve a path inside a scan root to somewhere outside it. */
let realPaths = new Map<string, string | null>();

vi.mock('node:fs/promises', () => ({
  realpath: (path: string) => {
    const resolved = realPaths.has(path) ? realPaths.get(path) : path;

    return resolved === null || resolved === undefined
      ? Promise.reject(new Error('ENOENT'))
      : Promise.resolve(resolved);
  },
}));

const stubReadiness = vi.hoisted(() => ({ readiness: null as Readiness | null }));

vi.mock('@libs/backends/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@libs/backends/runtime')>();

  return {
    ...actual,
    backendFor: (backend: BackendId) => {
      const resolved = actual.backendFor(backend);
      const readiness = stubReadiness.readiness;

      return readiness === null ? resolved : { ...resolved, definition: { ...resolved.definition, readiness } };
    },
  };
});

const configService = {
  modelDirs: ['/srv/models'],
  instanceNetwork: NETWORK,
  instanceStartTimeoutBaseMs: 120_000,
  instanceStartTimeoutPerGibMs: 20_000,
  instanceLogTailLines: 20,
} as unknown as ConfigService;

const container = (overrides: Partial<IInstanceContainer> = {}): IInstanceContainer => ({
  id: CONTAINER_ID,
  labels: {
    [INSTANCE_LABEL]: TEST_INSTANCE_KEY,
    [BACKEND_LABEL]: BackendId.LLAMA_CPP,
    ...adoptionLabels({
      revision: 1,
      probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200] },
      startTimeoutMs: START_TIMEOUT_MS,
      port: 8080,
    }),
  },
  running: true,
  startedAt: new Date(Date.now() - 5_000),
  exitCode: null,
  addresses: { [NETWORK]: CONTAINER_ADDRESS },
  ...overrides,
});

describe('InstanceRuntimeService', () => {
  let containerService: {
    listInstances: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stopAndRemove: ReturnType<typeof vi.fn>;
    tailLogs: ReturnType<typeof vi.fn>;
    hasImage: ReturnType<typeof vi.fn>;
    pullImage: ReturnType<typeof vi.fn>;
    ensureNetwork: ReturnType<typeof vi.fn>;
  };
  let readinessService: {
    isReady: ReturnType<typeof vi.fn>;
    watch: ReturnType<typeof vi.fn>;
    forget: ReturnType<typeof vi.fn>;
    changes: ReturnType<typeof vi.fn>;
  };
  let instanceRuntimeService: InstanceRuntimeService;
  let instanceEndpointService: InstanceEndpointService;

  beforeEach(async () => {
    realPaths = new Map();
    stubReadiness.readiness = null;

    containerService = {
      listInstances: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue(CONTAINER_ID),
      start: vi.fn().mockResolvedValue(undefined),
      stopAndRemove: vi.fn().mockResolvedValue(undefined),
      tailLogs: vi.fn().mockResolvedValue('error: failed to load model'),
      hasImage: vi.fn().mockResolvedValue(true),
      pullImage: vi.fn().mockResolvedValue(undefined),
      ensureNetwork: vi.fn().mockResolvedValue(undefined),
    };

    readinessService = {
      isReady: vi.fn().mockReturnValue(false),
      watch: vi.fn(),
      forget: vi.fn(),
      changes: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        InstanceRuntimeService,
        { provide: ConfigService, useValue: configService },
        { provide: ContainerService, useValue: containerService },
        { provide: ReadinessService, useValue: readinessService },
        InstanceEndpointService,
        ShardGrouperService,
      ],
    }).compile();

    instanceRuntimeService = moduleRef.get(InstanceRuntimeService);
    instanceEndpointService = moduleRef.get(InstanceEndpointService);
  });

  it('makes the network backends are reached on before it runs one', async () => {
    await instanceRuntimeService.onModuleInit();

    expect(containerService.ensureNetwork).toHaveBeenCalledWith(NETWORK);
  });

  describe('start', () => {
    it('creates the container from the rendered specification and starts it', async () => {
      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      expect(containerService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: `modelfleet-${TEST_INSTANCE_KEY}`,
          Image: 'ghcr.io/ggml-org/llama.cpp:server-cuda',
        })
      );
      expect(containerService.start).toHaveBeenCalledWith(CONTAINER_ID);
    });

    it('resolves the image itself where a server that predates resolving one sends none', async () => {
      await instanceRuntimeService.start(buildDesiredInstance({ image: null }), GPU_TOTALS);
      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);
      await instanceRuntimeService.start(
        buildDesiredInstance({ image: null, configuration: { image: 'mine:latest' } }),
        GPU_TOTALS
      );

      const images = containerService.create.mock.calls.map(call => (call[0] as Docker.ContainerCreateOptions).Image);

      expect(images).toEqual(['ghcr.io/ggml-org/llama.cpp:server-cuda', 'mine:latest']);
    });

    it('refuses to start where neither the server nor the backend names an image for the placement', async () => {
      const desired = buildDesiredInstance({
        backend: BackendId.VLLM_OMNI,
        image: null,
        pins: { cpu: true, gpus: [] },
      });

      await instanceRuntimeService.start(desired, GPU_TOTALS);

      expect(containerService.create).not.toHaveBeenCalled();
      expect(await instanceRuntimeService.list()).toEqual([
        expect.objectContaining({
          instanceState: InstanceState.FAILED,
          message: 'The vllm-omni backend has no cpu image, and the server named none',
        }),
      ]);
    });

    it("scales the launch timeout by the model's size where the backend states none", async () => {
      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      const labels = (containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions).Labels;

      expect(labels?.[START_TIMEOUT_LABEL]).toBe(
        String(launchTimeoutMs(buildDesiredInstance().model.sizeBytes, ms('2m'), ms('20s')))
      );
    });

    it('holds a backend that states its own start timeout to it, whatever the model size', async () => {
      stubReadiness.readiness = {
        probe: { method: ProbeMethod.GET, path: '/health', passStatuses: [200] },
        startTimeoutSeconds: 45,
      };

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      const labels = (containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions).Labels;

      expect(labels?.[START_TIMEOUT_LABEL]).toBe('45000');
    });

    it('mounts the weights the server named and pins the devices it named', async () => {
      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.NetworkMode).toBe(NETWORK);
      expect(body.HostConfig?.PortBindings).toBeUndefined();
      expect(body.HostConfig?.Binds).toEqual(['/srv/models/llama-3-8b/model.gguf:/models/model.gguf:ro']);
      expect(body.HostConfig?.DeviceRequests?.[0].DeviceIDs).toEqual([TEST_DEVICE_KEY]);
    });

    it('mounts the weights under the name a definition fixes, for an engine that looks for them by it', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({ backend: BackendId.KOKORO, weightsPath: '/srv/models/Kokoro-82M' }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual(['/srv/models/Kokoro-82M:/models/v1_0:ro']);
    });

    it("splits a vLLM-Omni instance's memory as a fraction of its card, from the total it was handed", async () => {
      const desired = buildDesiredInstance({
        backend: BackendId.VLLM_OMNI,
        weightsPath: '/srv/models/Qwen3-TTS',
        model: { ...buildDesiredInstance().model, architecture: 'qwen3_tts' },
        configuration: { gpuMemoryGib: 12 },
      });

      await instanceRuntimeService.start(desired, new Map([[TEST_DEVICE_KEY, 48 * 1024 ** 3]]));

      const command = (containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions).Cmd ?? [];

      expect(JSON.parse(command[command.indexOf('--stage-overrides') + 1])).toEqual({
        0: { [SHARE_KEY]: 0.125 },
        1: { [SHARE_KEY]: 0.125 },
      });
    });

    it('hands the pins it was sent to the renderer, rather than deciding the hardware itself', async () => {
      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);
      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);
      await instanceRuntimeService.start(buildDesiredInstance({ pins: { cpu: true, gpus: [] } }), GPU_TOTALS);

      const [onCards, onCpu] = containerService.create.mock.calls.map(
        call => (call[0] as Docker.ContainerCreateOptions).HostConfig?.DeviceRequests
      );

      expect(onCards).toEqual([{ Driver: 'nvidia', DeviceIDs: [TEST_DEVICE_KEY], Capabilities: [['gpu']] }]);
      expect(onCpu).toBeUndefined();
    });

    it('mounts a companion read-only under a directory of its own', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({
          configuration: { contextSize: 8192, mmproj: 'b'.repeat(64) },
          companionPaths: [{ field: 'mmproj', path: '/srv/models/gemma-3-4b/mmproj-F16.gguf' }],
        }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        '/srv/models/llama-3-8b/model.gguf:/models/model.gguf:ro',
        '/srv/models/gemma-3-4b/mmproj-F16.gguf:/models/mmproj/mmproj-F16.gguf:ro',
      ]);
    });

    it('keeps a companion apart from weights of the same basename', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({
          weightsPath: '/srv/models/model.gguf',
          configuration: { mmproj: 'b'.repeat(64) },
          companionPaths: [{ field: 'mmproj', path: '/srv/models/projector/model.gguf' }],
        }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        '/srv/models/model.gguf:/models/model.gguf:ro',
        '/srv/models/projector/model.gguf:/models/mmproj/model.gguf:ro',
      ]);
    });

    it('refuses a companion that sits outside every directory this node scans', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({
          configuration: { mmproj: 'b'.repeat(64) },
          companionPaths: [{ field: 'mmproj', path: '/etc/shadow' }],
        }),
        GPU_TOTALS
      );

      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.FAILED);
      expect(observed.message).toContain('outside every directory');
    });

    it('mounts every shard of a split set beside the first, in order', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/${SPLIT_FIRST}` }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        `${SPLIT_DIR}/${SPLIT_FIRST}:/models/${SPLIT_FIRST}:ro`,
        `${SPLIT_DIR}/${SPLIT_SECOND}:/models/${SPLIT_SECOND}:ro`,
        `${SPLIT_DIR}/${SPLIT_THIRD}:/models/${SPLIT_THIRD}:ro`,
      ]);
    });

    it('finds the shards of a set scanned in upper case, and names them in the container as llama.cpp does', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/QWEN-00001-OF-00002.GGUF` }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        `${SPLIT_DIR}/QWEN-00001-OF-00002.GGUF:/models/QWEN-00001-of-00002.gguf:ro`,
        `${SPLIT_DIR}/QWEN-00002-OF-00002.GGUF:/models/QWEN-00002-of-00002.gguf:ro`,
      ]);
    });

    it('names a symlinked split set inside the container as it was scanned, so llama.cpp finds its shards', async () => {
      realPaths = new Map([
        [`${SPLIT_DIR}/${SPLIT_FIRST}`, '/srv/models/blobs/aaa'],
        [`${SPLIT_DIR}/${SPLIT_SECOND}`, '/srv/models/blobs/bbb'],
        [`${SPLIT_DIR}/${SPLIT_THIRD}`, '/srv/models/blobs/ccc'],
      ]);

      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/${SPLIT_FIRST}` }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        `/srv/models/blobs/aaa:/models/${SPLIT_FIRST}:ro`,
        `/srv/models/blobs/bbb:/models/${SPLIT_SECOND}:ro`,
        `/srv/models/blobs/ccc:/models/${SPLIT_THIRD}:ro`,
      ]);
    });

    it('refuses a split set with shards missing before it pulls or creates anything, naming the first', async () => {
      realPaths = new Map<string, string | null>([
        [`${SPLIT_DIR}/${SPLIT_SECOND}`, null],
        [`${SPLIT_DIR}/${SPLIT_THIRD}`, null],
      ]);

      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/${SPLIT_FIRST}` }),
        GPU_TOTALS
      );

      expect(containerService.hasImage).not.toHaveBeenCalled();
      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.FAILED);
      expect(observed.message).toContain(`${SPLIT_DIR}/${SPLIT_SECOND} is not on this node`);
    });

    it('refuses a split set with a shard that resolves outside every directory this node scans', async () => {
      realPaths = new Map([[`${SPLIT_DIR}/${SPLIT_THIRD}`, '/etc/shadow']]);

      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/${SPLIT_FIRST}` }),
        GPU_TOTALS
      );

      expect(containerService.hasImage).not.toHaveBeenCalled();
      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.message).toContain(`${SPLIT_DIR}/${SPLIT_THIRD} sits outside every directory`);
    });

    it('refuses weights named by a shard other than the first, which llama.cpp cannot load a set from', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: `${SPLIT_DIR}/${SPLIT_SECOND}` }),
        GPU_TOTALS
      );

      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.FAILED);
      expect(observed.message).toContain('is shard 2 of 3, not the first');
    });

    it('mounts a file numbered one of one alone, as any single file', async () => {
      await instanceRuntimeService.start(
        buildDesiredInstance({ weightsPath: '/srv/models/qwen/qwen-Q4_K_M-00001-of-00001.gguf' }),
        GPU_TOTALS
      );

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual([
        '/srv/models/qwen/qwen-Q4_K_M-00001-of-00001.gguf:/models/qwen-Q4_K_M-00001-of-00001.gguf:ro',
      ]);
    });

    it('pulls an image the node does not hold and reports the instance starting', async () => {
      containerService.hasImage.mockResolvedValue(false);
      containerService.pullImage.mockReturnValue(new Promise<void>(() => undefined));

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      expect(containerService.create).not.toHaveBeenCalled();
      expect(containerService.pullImage).toHaveBeenCalledWith('ghcr.io/ggml-org/llama.cpp:server-cuda');

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.STARTING);
      expect(observed.message).toContain('Pulling');
    });

    it('pulls for each instance sharing an image, so the second is not left waiting on the first', async () => {
      const other = '01999999-2222-7222-8222-222222222222';

      containerService.hasImage.mockResolvedValue(false);
      containerService.pullImage.mockReturnValue(new Promise<void>(() => undefined));

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);
      await instanceRuntimeService.start(buildDesiredInstance({ instanceKey: other }), GPU_TOTALS);

      expect(containerService.pullImage).toHaveBeenCalledTimes(2);
      expect(await instanceRuntimeService.list()).toHaveLength(2);
    });

    it('reports what the daemon said even where removing the container it refused to start also fails', async () => {
      containerService.start.mockRejectedValue(Object.assign(new Error('no such device'), { statusCode: 400 }));
      containerService.stopAndRemove.mockRejectedValue(new Error('removal already in progress'));

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      const [observed] = await instanceRuntimeService.list();

      expect(observed.message).toBe('no such device');
    });

    it('follows a symlink before the root check, so one swapped in after the scan is refused', async () => {
      realPaths = new Map([['/srv/models/llama-3-8b/model.gguf', '/etc/shadow']]);

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.message).toContain('outside every directory');
    });

    it('follows a companion symlink before the root check too', async () => {
      realPaths = new Map([['/srv/models/projector/mmproj.gguf', '/etc/shadow']]);

      await instanceRuntimeService.start(
        buildDesiredInstance({
          configuration: { mmproj: 'b'.repeat(64) },
          companionPaths: [{ field: 'mmproj', path: '/srv/models/projector/mmproj.gguf' }],
        }),
        GPU_TOTALS
      );

      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.message).toContain('outside every directory');
    });

    it('binds the resolved path rather than the one the server named', async () => {
      realPaths = new Map([['/srv/models/link.gguf', '/srv/models/real/model.gguf']]);

      await instanceRuntimeService.start(buildDesiredInstance({ weightsPath: '/srv/models/link.gguf' }), GPU_TOTALS);

      const body = containerService.create.mock.calls[0][0] as Docker.ContainerCreateOptions;

      expect(body.HostConfig?.Binds).toEqual(['/srv/models/real/model.gguf:/models/model.gguf:ro']);
    });

    it('reports a companion that is not on the node at all', async () => {
      realPaths = new Map<string, string | null>([['/srv/models/projector/mmproj.gguf', null]]);

      await instanceRuntimeService.start(
        buildDesiredInstance({
          configuration: { mmproj: 'b'.repeat(64) },
          companionPaths: [{ field: 'mmproj', path: '/srv/models/projector/mmproj.gguf' }],
        }),
        GPU_TOTALS
      );

      const [observed] = await instanceRuntimeService.list();

      expect(observed.message).toContain('is not on this node');
    });

    it('refuses weights that sit outside every directory this node scans', async () => {
      await instanceRuntimeService.start(buildDesiredInstance({ weightsPath: '/etc/shadow' }), GPU_TOTALS);

      expect(containerService.create).not.toHaveBeenCalled();

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.FAILED);
      expect(observed.message).toContain('outside every directory');
    });

    it('reports a launch the daemon refused, with what the daemon said', async () => {
      containerService.create.mockRejectedValue(Object.assign(new Error('no such device'), { statusCode: 400 }));

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      expect(await instanceRuntimeService.list()).toEqual([
        expect.objectContaining({ instanceState: InstanceState.FAILED, message: 'no such device' }),
      ]);
    });

    it('raises an unreachable daemon rather than reporting a failure the operator cannot act on', async () => {
      containerService.create.mockRejectedValue(Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }));

      await expect(instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS)).rejects.toThrow(
        DockerUnavailableError
      );
    });
  });

  describe('list', () => {
    it('reads what the node holds off the labelled containers, so a restart re-adopts them', async () => {
      containerService.listInstances.mockResolvedValue([container()]);

      expect(await instanceRuntimeService.list()).toEqual([
        expect.objectContaining({ instanceKey: TEST_INSTANCE_KEY, revision: 1, instanceState: InstanceState.STARTING }),
      ]);
    });

    it('holds an instance starting until its probe passes, probing it on the agent network', async () => {
      containerService.listInstances.mockResolvedValue([container()]);

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.STARTING);
      expect(readinessService.watch).toHaveBeenCalledWith(
        TEST_INSTANCE_KEY,
        CONTAINER_ID,
        `http://${CONTAINER_ADDRESS}:8080`,
        expect.objectContaining({ path: '/health' })
      );
    });

    it('reports an instance ready once the probe has passed, without naming an address', async () => {
      containerService.listInstances.mockResolvedValue([container()]);
      readinessService.isReady.mockReturnValue(true);

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.READY);
      expect(observed).not.toHaveProperty('endpoint');
    });

    it('records where a ready instance is reached, so the relay resolves it without asking the daemon', async () => {
      containerService.listInstances.mockResolvedValue([container()]);
      readinessService.isReady.mockReturnValue(true);

      await instanceRuntimeService.list();

      expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toEqual({
        instanceState: InstanceState.READY,
        address: { host: CONTAINER_ADDRESS, port: 8080 },
      });
    });

    it('records an instance with no address yet, so the relay names its state rather than losing it', async () => {
      containerService.listInstances.mockResolvedValue([container({ addresses: {} })]);

      await instanceRuntimeService.list();

      expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toEqual({
        instanceState: InstanceState.STARTING,
        address: null,
      });
    });

    it('stops resolving an instance whose container is gone', async () => {
      containerService.listInstances.mockResolvedValue([container()]);
      await instanceRuntimeService.list();

      containerService.listInstances.mockResolvedValue([]);
      await instanceRuntimeService.list();

      expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toBeNull();
    });

    it("reports a container that exited with its code and the backend's own last output", async () => {
      containerService.listInstances.mockResolvedValue([container({ running: false, exitCode: 1, addresses: {} })]);

      expect(await instanceRuntimeService.list()).toEqual([
        expect.objectContaining({
          instanceState: InstanceState.FAILED,
          exitCode: 1,
          message: 'error: failed to load model',
          overran: false,
        }),
      ]);
      expect(containerService.stopAndRemove).not.toHaveBeenCalled();
    });

    it('fails a launch that never became ready within its timeout as overrun, keeping what the backend printed', async () => {
      vi.useFakeTimers();
      containerService.listInstances.mockResolvedValue([container()]);

      await instanceRuntimeService.list();
      vi.advanceTimersByTime(START_TIMEOUT_MS + 1_000);

      const [observed] = await instanceRuntimeService.list();

      expect(observed).toMatchObject({
        instanceState: InstanceState.FAILED,
        exitCode: null,
        message: 'error: failed to load model',
        overran: true,
      });

      vi.useRealTimers();
    });

    it('adopts a container running far longer than a launch window rather than condemning it on its age', async () => {
      containerService.listInstances.mockResolvedValue([
        container({ startedAt: new Date(Date.now() - START_TIMEOUT_MS * 20) }),
      ]);

      const [observed] = await instanceRuntimeService.list();

      expect(observed.instanceState).toBe(InstanceState.STARTING);
      expect(readinessService.watch).toHaveBeenCalled();
    });

    it('reports how long a running instance has been up', async () => {
      containerService.listInstances.mockResolvedValue([container({ startedAt: new Date(Date.now() - 30_000) })]);

      const [observed] = await instanceRuntimeService.list();

      expect(observed.uptimeMs).toBeGreaterThanOrEqual(30_000);
    });

    it('drops a launch attempt once a container answers for it', async () => {
      containerService.hasImage.mockResolvedValue(false);
      containerService.pullImage.mockReturnValue(new Promise<void>(() => undefined));

      await instanceRuntimeService.start(buildDesiredInstance(), GPU_TOTALS);

      containerService.listInstances.mockResolvedValue([container()]);

      expect(await instanceRuntimeService.list()).toHaveLength(1);
    });

    it('leaves out a container labelled with something that is not an instance key', async () => {
      containerService.listInstances.mockResolvedValue([
        container({ labels: { ...container().labels, [INSTANCE_LABEL]: 'a-hand-run-container' } }),
      ]);

      expect(await instanceRuntimeService.list()).toEqual([]);
    });

    it('raises an unreachable daemon rather than answering with nothing', async () => {
      containerService.listInstances.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );

      await expect(instanceRuntimeService.list()).rejects.toThrow(DockerUnavailableError);
    });
  });

  describe('stop', () => {
    it("stops the container with the backend's grace period and removes it", async () => {
      containerService.listInstances.mockResolvedValue([container()]);

      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);

      expect(containerService.stopAndRemove).toHaveBeenCalledWith(CONTAINER_ID, 30);
      expect(readinessService.forget).toHaveBeenCalledWith(TEST_INSTANCE_KEY);
    });

    it('stops relaying to the instance straight away rather than at the next sweep', async () => {
      containerService.listInstances.mockResolvedValue([container()]);
      readinessService.isReady.mockReturnValue(true);
      await instanceRuntimeService.list();

      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);

      expect(instanceEndpointService.resolve(TEST_INSTANCE_KEY)).toBeNull();
    });

    it('removes a container that has already exited, so its name is free for a replacement', async () => {
      containerService.listInstances.mockResolvedValue([container({ running: false, exitCode: 1 })]);

      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);

      expect(containerService.stopAndRemove).toHaveBeenCalledWith(CONTAINER_ID, 30);
    });

    it('leaves another instance container alone', async () => {
      containerService.listInstances.mockResolvedValue([
        container({ labels: { ...container().labels, [INSTANCE_LABEL]: 'someone-else' } }),
      ]);

      await instanceRuntimeService.stop(TEST_INSTANCE_KEY);

      expect(containerService.stopAndRemove).not.toHaveBeenCalled();
    });
  });
});
