import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentGpuInventory, AgentMessageType, AgentTelemetry, GpuVendor, TelemetryState } from '@libs/agent-protocol';

import { ServerConnectionService } from '@/server/server-connection.service';
import { TelemetryPublisher } from '@/telemetry/telemetry.publisher';
import { TelemetryService } from '@/telemetry/telemetry.service';

const INVENTORY: AgentGpuInventory = {
  devices: [
    {
      deviceKey: 'GPU-4f2c',
      vendor: GpuVendor.NVIDIA,
      name: 'NVIDIA GeForce RTX 3090',
      pciBusId: '0000:01:00.0',
      memoryTotalBytes: 25_757_220_864,
    },
  ],
};

const TELEMETRY: AgentTelemetry = {
  capturedAt: '2026-08-20T12:00:00.000Z',
  telemetryState: TelemetryState.OK,
  devices: [],
  host: { cpuModel: null, cpuCount: 8, loadAverage1m: null, memoryTotalBytes: 16, memoryFreeBytes: 8 },
  errors: [],
};

describe('TelemetryPublisher', () => {
  let telemetryChanges: Subject<AgentTelemetry>;
  let inventoryChanges: Subject<AgentGpuInventory>;
  let welcomes: Subject<void>;
  let send: ReturnType<typeof vi.fn>;
  let requestSnapshot: ReturnType<typeof vi.fn>;
  let currentInventory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    telemetryChanges = new Subject<AgentTelemetry>();
    inventoryChanges = new Subject<AgentGpuInventory>();
    welcomes = new Subject<void>();
    send = vi.fn();
    requestSnapshot = vi.fn();
    currentInventory = vi.fn().mockReturnValue(INVENTORY);

    const publisher = new TelemetryPublisher(
      {
        changes: () => telemetryChanges.asObservable(),
        inventoryChanges: () => inventoryChanges.asObservable(),
        currentInventory,
        requestSnapshot,
      } as unknown as TelemetryService,
      { sessionOpened: () => welcomes.asObservable(), send } as unknown as ServerConnectionService
    );

    publisher.onModuleInit();
  });

  it('sends the device set whenever it changes', () => {
    inventoryChanges.next(INVENTORY);

    expect(send).toHaveBeenCalledWith(AgentMessageType.GPU_INVENTORY, INVENTORY);
  });

  it('sends every reading', () => {
    telemetryChanges.next(TELEMETRY);

    expect(send).toHaveBeenCalledWith(AgentMessageType.TELEMETRY, TELEMETRY);
  });

  it('states the device set again on every welcome', () => {
    welcomes.next();

    expect(send).toHaveBeenCalledWith(AgentMessageType.GPU_INVENTORY, INVENTORY);
  });

  it('asks for a fresh reading on every welcome', () => {
    welcomes.next();
    welcomes.next();

    expect(requestSnapshot).toHaveBeenCalledTimes(2);
  });

  it('sends no device set on a welcome before the first reading', () => {
    currentInventory.mockReturnValue(null);

    welcomes.next();

    expect(send).not.toHaveBeenCalledWith(AgentMessageType.GPU_INVENTORY, expect.anything());
  });
});
