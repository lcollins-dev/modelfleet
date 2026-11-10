import {
  AGENT_SOCKET_PATH,
  AgentMessageType,
  AgentModelInventory,
  AgentPayloadMap,
  AgentTelemetry,
  GpuDevice,
  GpuVendor,
  InstanceState,
  ModelDirectoryWriteAccess,
  ModelFormat,
  ModelTask,
  ModelType,
  ObservedInstance,
  PROTOCOL_VERSION,
  ProcessAttribution,
  ProjectorModality,
  ServerDesiredState,
  ServerMessage,
  ServerMessageType,
  TelemetryState,
  decodeServerMessage,
  encodeAgentMessage,
} from '@libs/agent-protocol';

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const TIB = 1024 ** 4;

/** The key `seed.sql` gives rig-01, and the secret the test migrations hash for the development node. */
export const FAKE_NODE_KEY = '7c3e9a14-5b2d-4f81-a6e0-2d9b4c8f1e35';
const NODE_SECRET = 'mfn_dev-node-secret-not-a-real-secret';
const AGENT_VERSION = '0.0.0';

// Nothing listens here: the screenshots send no inference and read no container output.
const RELAY = { url: 'http://127.0.0.1:9', token: 'screenshots-relay-token-never-dialled' };

const MODEL_DIRECTORY = '/var/lib/modelfleet/models';

export const FAKE_GPU: GpuDevice = {
  deviceKey: 'GPU-3f9c1e52-7a4b-4d18-9e26-b05c8a1d7f43',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 5090',
  pciBusId: '00000000:01:00.0',
  memoryTotalBytes: 32_607 * MIB,
  index: 0,
};

const GPU_HEADROOM_BYTES = GIB;

const INSTANCE_VRAM_BYTES = 2_560 * MIB;
const INSTANCE_RESIDENT_BYTES = 4_198 * MIB;
const INSTANCE_SHARED_BYTES = 512 * MIB;

const HOST_MEMORY_TOTAL_BYTES = 125.5 * GIB;
const HOST_OTHER_BYTES = 7_578 * MIB;

/** Reported unchanged as a ready instance's uptime, so the uptime the shots show is fixed. */
export const INSTANCE_UPTIME_MS = (2 * 3_600 + 14 * 60 + 30) * 1_000;

const LAUNCH_MS = 1_000;

const GEMMA_SIZE_BYTES = 2_489_894_016;

// As the agent's scanner reads the published gemma-3-4b-it GGUF files.
const MODEL_INVENTORY: Omit<AgentModelInventory, 'scannedAt'> = {
  directories: [MODEL_DIRECTORY],
  models: [
    {
      fingerprint: '25494cb4bcf58f43c6c7fa46ae0cdcd02f73b50d514d2c8d18dfe98c4ae6eb5d',
      format: ModelFormat.GGUF,
      type: ModelType.MODEL,
      tasks: [ModelTask.CHAT],
      licence: null,
      modalities: null,
      sizeBytes: GEMMA_SIZE_BYTES,
      path: `${MODEL_DIRECTORY}/gemma-3-4b-it/gemma-3-4b-it-Q4_K_M.gguf`,
      shardCount: 1,
      name: 'Gemma-3-4B-It',
      ggufMetadata: {
        architecture: 'gemma3',
        quantisation: 'Q4_K',
        quantisationMixed: true,
        layerCount: 34,
        embeddingLength: 2_560,
        headCount: 8,
        headCountKv: 4,
        contextLength: 131_072,
        tensors: [{ name: 'token_embd.weight', sizeBytes: 550_636_800 }],
      },
      safetensorsMetadata: null,
    },
    {
      fingerprint: '9542f869ac6c76954568dffabf76f5adb63471fd002be196fa1bba287218fd9a',
      format: ModelFormat.GGUF,
      type: ModelType.PROJECTOR,
      tasks: [],
      licence: null,
      modalities: [ProjectorModality.VISION],
      sizeBytes: 851_251_328,
      path: `${MODEL_DIRECTORY}/gemma-3-4b-it/mmproj-F16.gguf`,
      shardCount: 1,
      name: 'Gemma-3-4B-It',
      ggufMetadata: {
        architecture: 'clip',
        quantisation: 'F16',
        quantisationMixed: true,
        layerCount: null,
        embeddingLength: null,
        headCount: null,
        headCountKv: null,
        contextLength: null,
        tensors: [],
      },
      safetensorsMetadata: null,
    },
  ],
  errors: [],
};

/** Connects as rig-01 and answers a desired instance as a launched one, with no Docker behind it. */
export class FakeAgent {
  private socket: WebSocket | null = null;

  private heartbeatIntervalMs = 10_000;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly launches = new Set<NodeJS.Timeout>();

  private readonly instances = new Map<string, ObservedInstance>();
  private desiredGeneration: number | null = null;

  async start(serverUrl: string): Promise<void> {
    const url = new URL(AGENT_SOCKET_PATH, serverUrl);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    const socket = new WebSocket(url);

    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        this.send(AgentMessageType.HELLO, {
          nodeKey: FAKE_NODE_KEY,
          secret: NODE_SECRET,
          agentVersion: AGENT_VERSION,
          protocolVersions: [PROTOCOL_VERSION],
          relay: RELAY,
          gpuHeadroomBytes: GPU_HEADROOM_BYTES,
        });
      });

      socket.addEventListener('message', event => {
        const decoded = decodeServerMessage(typeof event.data === 'string' ? event.data : '');

        if (!decoded.ok) {
          reject(new Error(`The fake agent could not read a frame: ${decoded.reason}`));

          return;
        }

        if (decoded.message.type === ServerMessageType.REJECT) {
          reject(new Error(`The server refused the fake agent: ${decoded.message.payload.message}`));

          return;
        }

        this.handle(decoded.message);

        if (decoded.message.type === ServerMessageType.WELCOME) {
          resolve();
        }
      });

      socket.addEventListener('close', () => {
        reject(new Error('The server closed the fake agent before welcoming it'));
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeat !== null) {
      clearTimeout(this.heartbeat);
    }

    for (const launch of this.launches) {
      clearTimeout(launch);
    }

    const socket = this.socket;

    if (socket === null || socket.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>(resolve => {
      socket.addEventListener('close', () => resolve());
      socket.close(1000);
    });
  }

  /** Sends the heartbeat, observed state and telemetry together, so their server stamps fall within milliseconds. */
  report(): void {
    this.send(AgentMessageType.HEARTBEAT, {});
    this.sendObservedState();
    this.send(AgentMessageType.TELEMETRY, this.telemetry());
    this.scheduleHeartbeat();
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case ServerMessageType.WELCOME:
        this.heartbeatIntervalMs = message.payload.heartbeatIntervalMs;
        this.send(AgentMessageType.GPU_INVENTORY, { devices: [FAKE_GPU] });
        this.send(AgentMessageType.MODEL_INVENTORY, this.modelInventory());
        this.report();
        break;
      case ServerMessageType.DESIRED_STATE:
        this.reconcile(message.payload);
        break;
      case ServerMessageType.SCAN_MODELS:
        this.send(AgentMessageType.MODEL_INVENTORY, this.modelInventory());
        break;
      case ServerMessageType.REJECT:
      case ServerMessageType.DESIRED_DOWNLOADS:
        // A rejection has already failed the start, and the screenshots start no download.
        break;
    }
  }

  private reconcile(desired: ServerDesiredState): void {
    const wanted = new Set(desired.instances.map(instance => instance.instanceKey));

    this.desiredGeneration = desired.generation;

    for (const instanceKey of this.instances.keys()) {
      if (!wanted.has(instanceKey)) {
        this.instances.delete(instanceKey);
      }
    }

    for (const instance of desired.instances) {
      if (this.instances.get(instance.instanceKey)?.revision === instance.revision) {
        continue;
      }

      this.instances.set(instance.instanceKey, {
        instanceKey: instance.instanceKey,
        revision: instance.revision,
        instanceState: InstanceState.STARTING,
        message: null,
        uptimeMs: 0,
        exitCode: null,
      });

      const launch = setTimeout(() => {
        this.launches.delete(launch);
        this.ready(instance.instanceKey);
      }, LAUNCH_MS);

      this.launches.add(launch);
    }

    this.sendObservedState();
    this.send(AgentMessageType.TELEMETRY, this.telemetry());
  }

  private ready(instanceKey: string): void {
    const instance = this.instances.get(instanceKey);

    if (instance === undefined) {
      return;
    }

    this.instances.set(instanceKey, { ...instance, instanceState: InstanceState.READY, uptimeMs: INSTANCE_UPTIME_MS });
    this.sendObservedState();
    this.send(AgentMessageType.TELEMETRY, this.telemetry());
  }

  private scheduleHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearTimeout(this.heartbeat);
    }

    this.heartbeat = setTimeout(() => {
      this.send(AgentMessageType.HEARTBEAT, {});
      this.send(AgentMessageType.TELEMETRY, this.telemetry());
      this.scheduleHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private sendObservedState(): void {
    this.send(AgentMessageType.OBSERVED_STATE, {
      desiredGeneration: this.desiredGeneration,
      instances: [...this.instances.values()],
    });
  }

  private modelInventory(): AgentModelInventory {
    return { ...MODEL_INVENTORY, scannedAt: new Date().toISOString() };
  }

  private telemetry(): AgentTelemetry {
    const ready = [...this.instances.values()].filter(instance => instance.instanceState === InstanceState.READY);
    const residentBytes = ready.length * INSTANCE_RESIDENT_BYTES;
    // The weights are mapped from disk, so the kernel counts their pages as free.
    const heldBytes = ready.length * GEMMA_SIZE_BYTES;

    return {
      capturedAt: new Date().toISOString(),
      telemetryState: TelemetryState.OK,
      devices: [
        {
          deviceKey: FAKE_GPU.deviceKey,
          index: 0,
          memoryUsedBytes: ready.length * INSTANCE_VRAM_BYTES,
          utilisationPercent: ready.length > 0 ? 11 : 0,
          temperatureC: ready.length > 0 ? 47 : 34,
          powerDrawWatts: ready.length > 0 ? 90 : 22,
          processAttribution: ProcessAttribution.EXACT,
          processes: ready.map((instance, position) => ({
            pid: 41_820 + position,
            usedBytes: INSTANCE_VRAM_BYTES,
            name: '/app/llama-server',
            containerId: null,
            containerName: null,
            instanceKey: instance.instanceKey,
          })),
        },
      ],
      host: {
        cpuModel: 'AMD EPYC 9124 16-Core Processor',
        cpuCount: 32,
        loadAverage1m: 1.37,
        memoryTotalBytes: HOST_MEMORY_TOTAL_BYTES,
        memoryFreeBytes: HOST_MEMORY_TOTAL_BYTES - HOST_OTHER_BYTES - residentBytes + heldBytes,
        modelDirectories: [
          {
            path: MODEL_DIRECTORY,
            freeBytes: Math.round(1.42 * TIB),
            totalBytes: Math.round(1.8 * TIB),
            writeAccess: ModelDirectoryWriteAccess.WRITABLE,
          },
        ],
        instanceMemory: ready.map(instance => ({
          instanceKey: instance.instanceKey,
          heldBytes: GEMMA_SIZE_BYTES,
          sharedBytes: INSTANCE_SHARED_BYTES,
          residentBytes: INSTANCE_RESIDENT_BYTES,
        })),
        heldMemory: { bytes: heldBytes, anyUnknown: false },
      },
      errors: [],
    };
  }

  private send<TType extends AgentMessageType>(type: TType, payload: AgentPayloadMap[TType]): void {
    this.socket?.send(encodeAgentMessage(type, payload));
  }
}
