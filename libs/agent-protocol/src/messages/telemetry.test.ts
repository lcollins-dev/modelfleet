import { describe, expect, it } from 'vitest';

import { decodeAgentMessage, encodeAgentMessage } from '../codec';
import { AgentMessageType } from '../message-type';
import {
  AgentGpuInventory,
  AgentTelemetry,
  GpuVendor,
  ModelDirectoryWriteAccess,
  ProcessAttribution,
  TelemetryErrorScope,
  TelemetryState,
  agentGpuInventorySchema,
  agentTelemetrySchema,
} from './telemetry';

const DEVICE_KEY = 'GPU-4f2c';
const INSTANCE_KEY = '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';

const inventory = (): AgentGpuInventory => ({
  devices: [
    {
      deviceKey: DEVICE_KEY,
      vendor: GpuVendor.NVIDIA,
      name: 'NVIDIA GeForce RTX 3090',
      pciBusId: '0000:01:00.0',
      memoryTotalBytes: 25_757_220_864,
      index: 0,
    },
  ],
});

const telemetry = (): AgentTelemetry => ({
  capturedAt: '2026-08-20T12:00:00.000Z',
  telemetryState: TelemetryState.OK,
  devices: [
    {
      deviceKey: DEVICE_KEY,
      index: 0,
      memoryUsedBytes: 21_474_836_480,
      utilisationPercent: 34,
      temperatureC: 61,
      powerDrawWatts: 220,
      processAttribution: ProcessAttribution.EXACT,
      processes: [
        {
          pid: 12345,
          usedBytes: 21_340_618_752,
          name: '/usr/bin/python3.11',
          containerId: 'abc123',
          containerName: 'vllm-qwen',
        },
      ],
    },
  ],
  host: {
    cpuModel: 'AMD Ryzen 9 5950X',
    cpuCount: 32,
    loadAverage1m: 1.42,
    memoryTotalBytes: 134_217_728_000,
    memoryFreeBytes: 64_424_509_440,
  },
  errors: [],
});

describe('telemetry messages', () => {
  it('carries an inventory report through the codec unchanged', () => {
    const frame = encodeAgentMessage(AgentMessageType.GPU_INVENTORY, inventory());
    const decoded = decodeAgentMessage(frame);

    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.message.payload).toEqual(inventory());
  });

  it('accepts an inventory from an agent that predates reporting the device index', () => {
    const result = agentGpuInventorySchema.safeParse({
      devices: [
        { deviceKey: DEVICE_KEY, vendor: GpuVendor.NVIDIA, name: null, pciBusId: null, memoryTotalBytes: null },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.devices[0].index).toBeUndefined();
  });

  it('refuses an inventory whose device index is beyond the devices a node can hold', () => {
    const result = agentGpuInventorySchema.safeParse({
      devices: [{ ...inventory().devices[0], index: 4_294_967_295 }],
    });

    expect(result.success).toBe(false);
  });

  it('carries a telemetry report through the codec unchanged', () => {
    const frame = encodeAgentMessage(AgentMessageType.TELEMETRY, telemetry());
    const decoded = decodeAgentMessage(frame);

    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.message.payload).toEqual(telemetry());
  });

  it('carries a degraded reading with no devices', () => {
    const degraded: AgentTelemetry = {
      ...telemetry(),
      telemetryState: TelemetryState.DEGRADED,
      devices: [],
      errors: [
        {
          scope: TelemetryErrorScope.PROVIDER,
          deviceKey: null,
          metric: null,
          message: 'The device reader exited with code 1',
        },
      ],
    };

    const decoded = decodeAgentMessage(encodeAgentMessage(AgentMessageType.TELEMETRY, degraded));

    expect(decoded.ok && decoded.message.payload).toEqual(degraded);
  });

  it('carries a device whose vendor supplied no metric', () => {
    const sparse: AgentTelemetry = {
      ...telemetry(),
      devices: [
        {
          deviceKey: DEVICE_KEY,
          index: 0,
          memoryUsedBytes: null,
          utilisationPercent: null,
          temperatureC: null,
          powerDrawWatts: null,
          processAttribution: ProcessAttribution.UNAVAILABLE,
          processes: [],
        },
      ],
    };

    const decoded = decodeAgentMessage(encodeAgentMessage(AgentMessageType.TELEMETRY, sparse));

    expect(decoded.ok && decoded.message.payload).toEqual(sparse);
  });

  it('refuses a reading whose utilisation is outside the percentage range', () => {
    const outOfRange = {
      ...telemetry(),
      devices: [{ ...telemetry().devices[0], utilisationPercent: 140 }],
    } as AgentTelemetry;

    expect(() => encodeAgentMessage(AgentMessageType.TELEMETRY, outOfRange)).toThrow();
  });

  it('carries the instance key of the container holding a process', () => {
    const labelled: AgentTelemetry = {
      ...telemetry(),
      devices: [
        {
          ...telemetry().devices[0],
          processes: [{ ...telemetry().devices[0].processes[0], instanceKey: INSTANCE_KEY }],
        },
      ],
    };

    const decoded = decodeAgentMessage(encodeAgentMessage(AgentMessageType.TELEMETRY, labelled));

    expect(decoded.ok && decoded.message.payload).toEqual(labelled);
  });

  it('refuses an instance key that is not a uuid', () => {
    const malformed = {
      ...telemetry(),
      devices: [
        {
          ...telemetry().devices[0],
          processes: [{ ...telemetry().devices[0].processes[0], instanceKey: 'vllm-qwen' }],
        },
      ],
    };

    expect(() => encodeAgentMessage(AgentMessageType.TELEMETRY, malformed)).toThrow();
  });

  it('carries the free space and write access in each model directory, with none where one could not be read', () => {
    const withSpace: AgentTelemetry = {
      ...telemetry(),
      host: {
        ...telemetry().host,
        modelDirectories: [
          {
            path: '/models',
            freeBytes: 412_316_860_416,
            totalBytes: 1_000_204_886_016,
            writeAccess: ModelDirectoryWriteAccess.READ_ONLY,
          },
          { path: '/mnt/gone', freeBytes: null, totalBytes: null, writeAccess: null },
        ],
      },
    };

    const decoded = decodeAgentMessage(encodeAgentMessage(AgentMessageType.TELEMETRY, withSpace));

    expect(decoded.ok && decoded.message.payload).toEqual(withSpace);
  });

  it('accepts a model directory from an agent that predates reporting write access', () => {
    const result = agentTelemetrySchema.safeParse({
      ...telemetry(),
      host: { ...telemetry().host, modelDirectories: [{ path: '/models', freeBytes: 1024, totalBytes: 2048 }] },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.host.modelDirectories?.[0].writeAccess).toBeUndefined();
  });

  it('accepts a reading from an agent that predates reporting free space', () => {
    const result = agentTelemetrySchema.safeParse(telemetry());

    expect(result.success).toBe(true);
    expect(result.success && result.data.host.modelDirectories).toBeUndefined();
  });
});
