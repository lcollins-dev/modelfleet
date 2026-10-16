import { Subject } from 'rxjs';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentGpuInventory,
  AgentTelemetry,
  agentGpuInventorySchema,
  MAX_DEVICE_NAME_LENGTH,
  MAX_PCI_BUS_ID_LENGTH,
  TelemetryState,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { ContainerLookupService } from '@/docker/container-lookup.service';
import { DeviceReaderService } from '@/telemetry/device-reader/device-reader.service';
import { GpuSnapshot } from '@/telemetry/device-reader/gpu-snapshot';
import { HostResourcesService } from '@/telemetry/host-resources.service';
import { TelemetryService } from '@/telemetry/telemetry.service';

const CONFIG = {
  telemetryDegradedAfter: 3,
  telemetryAttributionMaxAgeMs: 30_000,
} as unknown as ConfigService;

const INSTANCE_KEY = '0199a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b';

const settled = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

const HOST = {
  cpuModel: 'AMD Ryzen 9 5950X',
  cpuCount: 32,
  loadAverage1m: 1.42,
  memoryTotalBytes: 134_217_728_000,
  memoryFreeBytes: 64_424_509_440,
};

const device = (overrides: Partial<GpuSnapshot['devices'][number]> = {}): GpuSnapshot['devices'][number] =>
  ({
    uuid: 'GPU-4f2c',
    pciBusId: '0000:01:00.0',
    index: 0,
    vendor: 'nvidia',
    name: 'NVIDIA GeForce RTX 3090',
    memoryTotalBytes: 25_757_220_864,
    memoryUsedBytes: 21_474_836_480,
    utilisationPercent: 34,
    temperatureC: 61,
    powerDrawWatts: 220,
    processAttribution: 'exact',
    processes: [{ pid: 12345, usedBytes: 21_340_618_752, name: '/usr/bin/python3.11' }],
    ...overrides,
  }) as GpuSnapshot['devices'][number];

const snapshot = (devices = [device()], errors: GpuSnapshot['errors'] = []): GpuSnapshot => ({
  schema: 1,
  capturedAt: '2026-08-20T12:00:00.000Z',
  devices,
  errors,
});

describe('TelemetryService', () => {
  let snapshots: Subject<GpuSnapshot>;
  let failures: Subject<string>;
  let requestSnapshot: ReturnType<typeof vi.fn>;
  let resolveContainers: ReturnType<typeof vi.fn>;
  let service: TelemetryService;
  let telemetry: AgentTelemetry[];
  let readHost: Mock<HostResourcesService['read']>;
  let inventories: AgentGpuInventory[];

  beforeEach(() => {
    snapshots = new Subject<GpuSnapshot>();
    failures = new Subject<string>();
    requestSnapshot = vi.fn();
    resolveContainers = vi
      .fn()
      .mockResolvedValue(new Map([[12345, { id: 'abc123', name: 'vllm-qwen', instanceKey: INSTANCE_KEY }]]));

    const deviceReader = {
      snapshotStream: () => snapshots.asObservable(),
      failureStream: () => failures.asObservable(),
      start: vi.fn(),
      requestSnapshot,
    } as unknown as DeviceReaderService;

    const attribution = { resolve: resolveContainers } as unknown as ContainerLookupService;

    readHost = vi.fn<HostResourcesService['read']>().mockResolvedValue(HOST);

    const hostResourcesService = { read: readHost } as unknown as HostResourcesService;

    service = new TelemetryService(CONFIG, deviceReader, attribution, hostResourcesService);

    telemetry = [];
    inventories = [];

    service.changes().subscribe(reading => telemetry.push(reading));
    service.inventoryChanges().subscribe(inventory => inventories.push(inventory));

    service.onModuleInit();
  });

  it('reports what a device is doing, naming the container holding each process', async () => {
    snapshots.next(snapshot());
    await settled();

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].telemetryState).toBe(TelemetryState.OK);
    expect(telemetry[0].devices[0]).toMatchObject({
      deviceKey: 'GPU-4f2c',
      index: 0,
      memoryUsedBytes: 21_474_836_480,
      utilisationPercent: 34,
    });
    expect(telemetry[0].devices[0].processes[0]).toEqual({
      pid: 12345,
      usedBytes: 21_340_618_752,
      name: '/usr/bin/python3.11',
      containerId: 'abc123',
      containerName: 'vllm-qwen',
      instanceKey: INSTANCE_KEY,
    });
  });

  it('names a process the vendor could not name as unnamed', async () => {
    snapshots.next(snapshot([device({ processes: [{ pid: 12345, usedBytes: 1 }] })]));
    await settled();

    expect(telemetry[0].devices[0].processes[0].name).toBeNull();
  });

  it('leaves a process no container holds unattributed rather than dropping it', async () => {
    resolveContainers.mockResolvedValue(new Map());

    snapshots.next(snapshot());
    await settled();

    expect(telemetry[0].devices[0].processes[0]).toMatchObject({
      pid: 12345,
      containerId: null,
      containerName: null,
      instanceKey: null,
    });
  });

  it('reads host memory and cpu from the machine itself', async () => {
    snapshots.next(snapshot());
    await settled();

    expect(telemetry[0].host).toEqual(HOST);
  });

  it('reports host resources alongside a degraded reading', async () => {
    failures.next('one');
    failures.next('two');
    failures.next('three');
    await settled();

    expect(telemetry[0].host).toEqual(HOST);
  });

  it('announces the device set the first time it is read', async () => {
    snapshots.next(snapshot());
    await settled();

    expect(inventories).toHaveLength(1);
    expect(inventories[0].devices[0]).toEqual({
      deviceKey: 'GPU-4f2c',
      vendor: 'nvidia',
      name: 'NVIDIA GeForce RTX 3090',
      pciBusId: '0000:01:00.0',
      memoryTotalBytes: 25_757_220_864,
      index: 0,
    });
  });

  it('clamps each reported string to its cap, so one long value cannot fail the whole inventory', async () => {
    snapshots.next(snapshot([device({ name: 'n'.repeat(500), pciBusId: 'p'.repeat(500) })]));
    await settled();

    expect(agentGpuInventorySchema.safeParse(inventories[0]).success).toBe(true);
    expect(inventories[0].devices[0].name).toHaveLength(MAX_DEVICE_NAME_LENGTH);
    expect(inventories[0].devices[0].pciBusId).toHaveLength(MAX_PCI_BUS_ID_LENGTH);
  });

  it('stays quiet while the device set is unchanged', async () => {
    snapshots.next(snapshot());
    await settled();
    snapshots.next(snapshot([device({ memoryUsedBytes: 12, utilisationPercent: 99 })]));
    await settled();

    expect(inventories).toHaveLength(1);
    expect(telemetry).toHaveLength(2);
  });

  it('announces the device set again once a device is added', async () => {
    snapshots.next(snapshot());
    await settled();
    snapshots.next(snapshot([device(), device({ uuid: 'GPU-9a1b', index: 1 })]));
    await settled();

    expect(inventories).toHaveLength(2);
    expect(inventories[1].devices).toHaveLength(2);
  });

  it('announces the device set again once the devices are renumbered', async () => {
    snapshots.next(snapshot([device(), device({ uuid: 'GPU-9a1b', index: 1 })]));
    await settled();
    snapshots.next(snapshot([device({ index: 1 }), device({ uuid: 'GPU-9a1b', index: 0 })]));
    await settled();

    expect(inventories).toHaveLength(2);
    expect(inventories[1].devices.map(announced => [announced.deviceKey, announced.index])).toEqual([
      ['GPU-4f2c', 1],
      ['GPU-9a1b', 0],
    ]);
  });

  it('announces the device set again once a device is gone', async () => {
    snapshots.next(snapshot([device(), device({ uuid: 'GPU-9a1b', index: 1 })]));
    await settled();
    snapshots.next(snapshot());
    await settled();

    expect(inventories).toHaveLength(2);
    expect(inventories[1].devices).toHaveLength(1);
  });

  it('skips a device the vendor gives no uuid for, whatever slot it sits in', async () => {
    snapshots.next(snapshot([device({ uuid: undefined, index: 3 })]));
    await settled();

    expect(telemetry[0].devices).toHaveLength(0);
    expect(telemetry[0].errors[0].message).toContain('index 3');
  });

  it('carries the errors a partial reading reported', async () => {
    const errors = [
      { scope: 'metric', vendor: 'nvidia', device: 'GPU-4f2c', metric: 'temperature', message: 'read failed' },
    ] as GpuSnapshot['errors'];

    snapshots.next(snapshot([device()], errors));
    await settled();

    expect(telemetry[0].errors[0]).toEqual({
      scope: 'metric',
      deviceKey: 'GPU-4f2c',
      metric: 'temperature',
      message: 'read failed',
    });
  });

  it('keeps quiet until failures repeat', async () => {
    failures.next('The device reader exited with code 1');
    failures.next('The device reader exited with code 1');
    await settled();

    expect(telemetry).toHaveLength(0);
  });

  it('calls telemetry degraded once failures repeat', async () => {
    failures.next('one');
    failures.next('two');
    failures.next('three');
    await settled();

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].telemetryState).toBe(TelemetryState.DEGRADED);
    expect(telemetry[0].devices).toHaveLength(0);
    expect(telemetry[0].errors[0].message).toBe('three');
  });

  it('keeps the device set it last read while telemetry is degraded', async () => {
    snapshots.next(snapshot());
    await settled();

    failures.next('one');
    failures.next('two');
    failures.next('three');
    await settled();

    expect(service.currentInventory()?.devices).toHaveLength(1);
  });

  it('drops a degraded reading that a snapshot overtook while the host was read', async () => {
    let releaseHost: () => void = () => undefined;

    readHost.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseHost = () => resolve(HOST);
        })
    );

    failures.next('one');
    failures.next('two');
    failures.next('three');

    snapshots.next(snapshot());
    await settled();

    releaseHost();
    await settled();

    expect(telemetry.map(reading => reading.telemetryState)).toEqual([TelemetryState.OK]);
  });

  it('forgets the failures once a snapshot arrives again', async () => {
    failures.next('one');
    failures.next('two');

    snapshots.next(snapshot());
    await settled();

    failures.next('three');
    await settled();

    expect(telemetry.filter(reading => reading.telemetryState === TelemetryState.DEGRADED)).toHaveLength(0);
  });

  it('passes a snapshot request to the reader', () => {
    service.requestSnapshot();

    expect(requestSnapshot).toHaveBeenCalledTimes(1);
  });
});
