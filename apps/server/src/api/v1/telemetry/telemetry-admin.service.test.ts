import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentTelemetry,
  GpuVendor,
  ModelDirectoryWriteAccess as ProtocolModelDirectoryWriteAccess,
  ProcessAttribution,
  TelemetryErrorScope,
  TelemetryState,
} from '@libs/agent-protocol';
import { GIB } from '@libs/backends';
import {
  GpuProcessAttribution,
  GpuVendor as DtoGpuVendor,
  FleetTelemetryResponseDto,
  NodeTelemetryStatusDto,
  ModelDirectoryWriteAccess,
  NodeState,
  NodeTelemetryState,
} from '@libs/dto';

import { Gpu } from '@/core/gpu/entities/gpu.entity';

import { TelemetryAdminService } from '@/api/v1/telemetry/telemetry-admin.service';
import { GpuService } from '@/core/gpu/gpu.service';
import { InstanceService } from '@/core/instance/instance.service';
import { VramLedgerService } from '@/core/ledger/vram-ledger.service';
import { NodeService } from '@/core/node/node.service';
import { TelemetryService } from '@/core/telemetry/telemetry.service';

const NODE_ID = 7;

const settle = () => new Promise(resolve => setImmediate(resolve));

const row = (id: number, overrides: Partial<Gpu> = {}): Gpu =>
  ({
    id,
    nodeId: NODE_ID,
    deviceKey: 'GPU-4f2c',
    vendor: GpuVendor.NVIDIA,
    name: 'NVIDIA GeForce RTX 3090',
    pciBusId: '0000:01:00.0',
    memoryTotalBytes: 25_757_220_864,
    index: 0,
    lastReportedDate: new Date('2026-08-19T12:00:00.000Z'),
    createdDate: new Date('2026-08-19T12:00:00.000Z'),
    ...overrides,
  }) as Gpu;

const telemetry = (overrides: Partial<AgentTelemetry> = {}): AgentTelemetry => ({
  capturedAt: '2026-08-20T12:00:00.000Z',
  telemetryState: TelemetryState.OK,
  devices: [
    {
      deviceKey: 'GPU-4f2c',
      index: 0,
      memoryUsedBytes: 21_474_836_480,
      utilisationPercent: 34,
      temperatureC: 61,
      powerDrawWatts: 220,
      processAttribution: ProcessAttribution.EXACT,
      processes: [
        { pid: 12_345, usedBytes: 21_340_618_752, name: '/usr/bin/python3.11', containerId: null, containerName: null },
      ],
    },
  ],
  host: {
    cpuModel: 'AMD Ryzen 9 5950X',
    cpuCount: 32,
    loadAverage1m: 1.2,
    memoryTotalBytes: 67_386_753_024,
    memoryFreeBytes: 41_231_686_144,
  },
  errors: [],
  ...overrides,
});

describe('TelemetryAdminService', () => {
  let telemetryAdminService: TelemetryAdminService;
  let telemetryService: TelemetryService;
  let findByNodeIdMock: ReturnType<typeof vi.fn>;
  let findWithThrowMock: ReturnType<typeof vi.fn>;
  let findAllGpusMock: ReturnType<typeof vi.fn>;
  let findAllNodesMock: ReturnType<typeof vi.fn>;
  let predictionsOnMock: ReturnType<typeof vi.fn>;
  let findInstancesByNodeIdMock: ReturnType<typeof vi.fn>;
  let headroomForMock: ReturnType<typeof vi.fn>;
  let subscription: Subscription | null = null;

  beforeEach(async () => {
    findByNodeIdMock = vi.fn().mockResolvedValue([]);
    findWithThrowMock = vi.fn().mockResolvedValue({ id: NODE_ID });
    findAllGpusMock = vi.fn().mockResolvedValue([]);
    findAllNodesMock = vi.fn().mockResolvedValue([]);
    predictionsOnMock = vi.fn().mockReturnValue([]);
    findInstancesByNodeIdMock = vi.fn().mockResolvedValue([]);
    headroomForMock = vi.fn().mockReturnValue(GIB);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TelemetryAdminService,
        TelemetryService,
        { provide: GpuService, useValue: { findByNodeId: findByNodeIdMock, findAll: findAllGpusMock } },
        {
          provide: NodeService,
          useValue: {
            findWithThrow: findWithThrowMock,
            findAll: findAllNodesMock,
            getState: vi.fn().mockReturnValue(NodeState.ONLINE),
          },
        },
        { provide: VramLedgerService, useValue: { predictionsOn: predictionsOnMock, headroomFor: headroomForMock } },
        {
          provide: InstanceService,
          useValue: { findByNodeId: findInstancesByNodeIdMock, findAll: vi.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    telemetryAdminService = moduleRef.get(TelemetryAdminService);
    telemetryService = moduleRef.get(TelemetryService);
  });

  afterEach(() => {
    subscription?.unsubscribe();
    subscription = null;
  });

  it('refuses a node that does not exist rather than reading as one holding no devices', async () => {
    findWithThrowMock.mockRejectedValue(new BadRequestException());

    await expect(telemetryAdminService.getNodeTelemetryStatus(NODE_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(findByNodeIdMock).not.toHaveBeenCalled();
  });

  it('carries a live reading onto the device it names', async () => {
    findByNodeIdMock.mockResolvedValue([row(1)]);
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.telemetryState).toBe(NodeTelemetryState.OK);
    expect(status.capturedAt).toEqual(new Date('2026-08-20T12:00:00.000Z'));
    expect(status.receivedAt).not.toBeNull();
    expect(status.devices).toHaveLength(1);
    expect(status.devices[0]).toMatchObject({
      deviceKey: 'GPU-4f2c',
      vendor: DtoGpuVendor.NVIDIA,
      memoryTotalBytes: 25_757_220_864,
      memoryUsedBytes: 21_474_836_480,
      utilisationPercent: 34,
      temperatureC: 61,
      powerDrawWatts: 220,
      processAttribution: GpuProcessAttribution.EXACT,
    });
    expect(status.devices[0].processes).toEqual([
      {
        pid: 12_345,
        usedBytes: 21_340_618_752,
        name: '/usr/bin/python3.11',
        containerId: null,
        containerName: null,
        instanceKey: null,
        deploymentName: null,
      },
    ]);
  });

  it('names the instance holding a process where the agent labelled it', async () => {
    const instanceKey = '01999999-1111-7111-8111-111111111111';
    const reading = telemetry();

    reading.devices[0].processes[0].instanceKey = instanceKey;

    findByNodeIdMock.mockResolvedValue([row(1)]);
    telemetryService.recordTelemetry(NODE_ID, reading);

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices[0].processes[0].instanceKey).toBe(instanceKey);
  });

  it('carries the host cpu and memory the node reported', async () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.host).toEqual({
      cpuModel: 'AMD Ryzen 9 5950X',
      cpuCount: 32,
      loadAverage1m: 1.2,
      memoryTotalBytes: 67_386_753_024,
      memoryFreeBytes: 41_231_686_144,
      modelDirectories: [],
    });
  });

  it('carries the free space and write access the node reported in each model directory, in its order', async () => {
    const modelDirectories = [
      {
        path: '/models',
        freeBytes: 412_316_860_416,
        totalBytes: 1_000_204_886_016,
        writeAccess: ProtocolModelDirectoryWriteAccess.READ_ONLY,
      },
      { path: '/mnt/gone', freeBytes: null, totalBytes: null, writeAccess: null },
    ];

    telemetryService.recordTelemetry(NODE_ID, telemetry({ host: { ...telemetry().host, modelDirectories } }));

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.host?.modelDirectories).toEqual([
      {
        path: '/models',
        freeBytes: 412_316_860_416,
        totalBytes: 1_000_204_886_016,
        writeAccess: ModelDirectoryWriteAccess.READ_ONLY,
      },
      { path: '/mnt/gone', freeBytes: null, totalBytes: null, writeAccess: null },
    ]);
  });

  it('reads write access as unknown from an agent that predates reporting it', async () => {
    const modelDirectories = [{ path: '/models', freeBytes: 1024, totalBytes: 2048 }];

    telemetryService.recordTelemetry(NODE_ID, telemetry({ host: { ...telemetry().host, modelDirectories } }));

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.host?.modelDirectories).toEqual([
      { path: '/models', freeBytes: 1024, totalBytes: 2048, writeAccess: null },
    ]);
  });

  it('reports a device with no reading rather than dropping it', async () => {
    findByNodeIdMock.mockResolvedValue([row(1), row(2, { deviceKey: 'GPU-9a1b' })]);
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices).toHaveLength(2);
    expect(status.devices[1]).toMatchObject({
      deviceKey: 'GPU-9a1b',
      memoryUsedBytes: null,
      utilisationPercent: null,
      temperatureC: null,
      processAttribution: null,
      processes: [],
    });
  });

  it('carries the index the node last reported for a device no reading covers', async () => {
    findByNodeIdMock.mockResolvedValue([row(1, { index: 3 })]);

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices[0].index).toBe(3);
  });

  it('labels a device with the index it is listed by while a renumbered reading is ahead of the inventory', async () => {
    findByNodeIdMock.mockResolvedValue([row(1, { index: 3 })]);
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices[0].index).toBe(3);
  });

  it("carries the reading's index for a device from an agent that predates storing it", async () => {
    findByNodeIdMock.mockResolvedValue([row(1, { index: null })]);
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices[0].index).toBe(0);
  });

  it('reports the inventory alone where the node has sent no telemetry', async () => {
    findByNodeIdMock.mockResolvedValue([row(1)]);

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.telemetryState).toBeNull();
    expect(status.capturedAt).toBeNull();
    expect(status.host).toBeNull();
    expect(status.errors).toEqual([]);
    expect(status.devices[0]).toMatchObject({ deviceKey: 'GPU-4f2c', memoryUsedBytes: null });
  });

  it('reports a node holding no devices as an empty set rather than an error', async () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry({ devices: [] }));

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.devices).toEqual([]);
    expect(status.telemetryState).toBe(NodeTelemetryState.OK);
  });

  it('carries the reading errors through with a degraded state', async () => {
    findByNodeIdMock.mockResolvedValue([row(1)]);
    telemetryService.recordTelemetry(
      NODE_ID,
      telemetry({
        telemetryState: TelemetryState.DEGRADED,
        errors: [
          {
            scope: TelemetryErrorScope.METRIC,
            deviceKey: 'GPU-4f2c',
            metric: 'temperatureC',
            message: 'Not supported',
          },
        ],
      })
    );

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.telemetryState).toBe(NodeTelemetryState.DEGRADED);
    expect(status.errors).toEqual([
      { scope: 'metric', deviceKey: 'GPU-4f2c', metric: 'temperatureC', message: 'Not supported' },
    ]);
  });

  it("forgets a node's reading when its session closes", async () => {
    findByNodeIdMock.mockResolvedValue([row(1)]);
    telemetryService.recordTelemetry(NODE_ID, telemetry());
    telemetryService.forget(NODE_ID);

    const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

    expect(status.telemetryState).toBeNull();
    expect(status.devices[0].memoryUsedBytes).toBeNull();
  });

  describe("the ledger's figures", () => {
    const LOADING_KEY = '01999999-0000-7000-8000-000000000001';
    const SERVING_KEY = '01999999-0000-7000-8000-000000000002';

    const instance = (instanceKey: string, deploymentName: string) => ({
      instanceKey,
      deployment: { name: deploymentName },
    });

    it("names each prediction by the deployment it is loading, and carries the node's headroom", async () => {
      findByNodeIdMock.mockResolvedValue([row(1)]);
      findInstancesByNodeIdMock.mockResolvedValue([instance(LOADING_KEY, 'llama-70b-chat')]);
      predictionsOnMock.mockReturnValue([{ instanceKey: LOADING_KEY, bytes: 6 * GIB }]);

      await expect(telemetryAdminService.getNodeTelemetryStatus(NODE_ID)).resolves.toMatchObject({
        headroomBytes: GIB,
        devices: [
          {
            deviceKey: 'GPU-4f2c',
            predictions: [{ instanceKey: LOADING_KEY, deploymentName: 'llama-70b-chat', bytes: 6 * GIB }],
          },
        ],
      });
      expect(predictionsOnMock).toHaveBeenCalledWith(NODE_ID, 'GPU-4f2c');
      expect(headroomForMock).toHaveBeenCalledWith(NODE_ID);
    });

    it('names no deployment for a prediction whose instance has gone', async () => {
      findByNodeIdMock.mockResolvedValue([row(1)]);
      predictionsOnMock.mockReturnValue([{ instanceKey: LOADING_KEY, bytes: 6 * GIB }]);

      const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

      expect(status.devices[0].predictions[0].deploymentName).toBeNull();
    });

    it("names a process by its instance's deployment, and names none outside Modelfleet", async () => {
      findByNodeIdMock.mockResolvedValue([row(1)]);
      findInstancesByNodeIdMock.mockResolvedValue([instance(SERVING_KEY, 'qwen-coder')]);

      const external = { pid: 1, usedBytes: GIB, name: '/usr/bin/Xorg', containerId: null, containerName: null };
      const served = { ...external, pid: 2, name: '/app/llama-server', instanceKey: SERVING_KEY };

      telemetryService.recordTelemetry(
        NODE_ID,
        telemetry({ devices: [{ ...telemetry().devices[0], processes: [external, served] }] })
      );

      const status = await telemetryAdminService.getNodeTelemetryStatus(NODE_ID);

      expect(status.devices[0].processes.map(process => process.deploymentName)).toEqual([null, 'qwen-coder']);
    });

    it('is read afresh for each reading the stream emits', async () => {
      findByNodeIdMock.mockResolvedValue([row(1)]);
      predictionsOnMock.mockReturnValue([{ instanceKey: LOADING_KEY, bytes: 6 * GIB }]);

      const seen: NodeTelemetryStatusDto[] = [];
      const statuses = await telemetryAdminService.watchNodeTelemetryStatus(NODE_ID);

      subscription = statuses.subscribe(status => seen.push(status));

      await settle();

      predictionsOnMock.mockReturnValue([]);
      telemetryService.recordTelemetry(NODE_ID, telemetry());

      await settle();

      expect(seen.map(status => status.devices[0].predictions.length)).toEqual([1, 0]);
    });
  });

  describe('watchNodeTelemetryStatus', () => {
    it('refuses an unknown node before opening the stream', async () => {
      findWithThrowMock.mockRejectedValue(new BadRequestException());

      await expect(telemetryAdminService.watchNodeTelemetryStatus(NODE_ID)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emits the current status first', async () => {
      findByNodeIdMock.mockResolvedValue([row(1)]);

      const seen: NodeTelemetryStatusDto[] = [];
      const statuses = await telemetryAdminService.watchNodeTelemetryStatus(NODE_ID);

      subscription = statuses.subscribe(status => seen.push(status));

      await settle();

      expect(seen).toHaveLength(1);
      expect(seen[0].telemetryState).toBeNull();
    });

    it('emits again for each reading the node reports', async () => {
      const seen: NodeTelemetryStatusDto[] = [];
      const statuses = await telemetryAdminService.watchNodeTelemetryStatus(NODE_ID);

      subscription = statuses.subscribe(status => seen.push(status));

      await settle();

      telemetryService.recordTelemetry(NODE_ID, telemetry());

      await settle();

      expect(seen).toHaveLength(2);
      expect(seen[1].telemetryState).toBe(NodeTelemetryState.OK);
    });

    it('ignores a reading from another node', async () => {
      const seen: NodeTelemetryStatusDto[] = [];
      const statuses = await telemetryAdminService.watchNodeTelemetryStatus(NODE_ID);

      subscription = statuses.subscribe(status => seen.push(status));

      await settle();

      telemetryService.recordTelemetry(NODE_ID + 1, telemetry());

      await settle();

      expect(seen).toHaveLength(1);
    });
  });

  describe('getFleetTelemetry', () => {
    it('carries each node its own devices and reading', async () => {
      findAllNodesMock.mockResolvedValue([
        { id: NODE_ID, name: 'gpu-a-01' },
        { id: NODE_ID + 1, name: 'gpu-b-02' },
      ]);
      findAllGpusMock.mockResolvedValue([row(1), row(2, { nodeId: NODE_ID + 1, deviceKey: 'GPU-9a1b' })]);
      telemetryService.recordTelemetry(NODE_ID, telemetry());

      const fleet = await telemetryAdminService.getFleetTelemetry();

      expect(fleet.nodes.map(node => node.nodeName)).toEqual(['gpu-a-01', 'gpu-b-02']);
      expect(fleet.nodes[0].nodeId).toBe(NODE_ID);
      expect(fleet.nodes[0].status.devices[0]).toMatchObject({
        deviceKey: 'GPU-4f2c',
        memoryUsedBytes: 21_474_836_480,
      });
      expect(fleet.nodes[1].status.telemetryState).toBeNull();
      expect(fleet.nodes[1].status.devices.map(device => device.deviceKey)).toEqual(['GPU-9a1b']);
    });

    it('lists a node that holds no devices', async () => {
      findAllNodesMock.mockResolvedValue([{ id: NODE_ID, name: 'gpu-a-01' }]);

      const fleet = await telemetryAdminService.getFleetTelemetry();

      expect(fleet.nodes).toHaveLength(1);
      expect(fleet.nodes[0].status.devices).toEqual([]);
    });
  });

  describe('watchFleetTelemetry', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('emits the whole fleet first', async () => {
      findAllNodesMock.mockResolvedValue([{ id: NODE_ID, name: 'gpu-a-01' }]);

      const seen: FleetTelemetryResponseDto[] = [];
      const fleet = await telemetryAdminService.watchFleetTelemetry();

      subscription = fleet.subscribe(response => seen.push(response));

      await settle();

      expect(seen).toHaveLength(1);
      expect(seen[0].nodes[0].nodeName).toBe('gpu-a-01');
    });

    it('folds a burst of readings from several nodes into one emission', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
      findAllNodesMock.mockResolvedValue([{ id: NODE_ID, name: 'gpu-a-01' }]);

      const seen: FleetTelemetryResponseDto[] = [];
      const fleet = await telemetryAdminService.watchFleetTelemetry();

      subscription = fleet.subscribe(response => seen.push(response));

      await settle();

      telemetryService.recordTelemetry(NODE_ID, telemetry());
      telemetryService.recordTelemetry(NODE_ID + 1, telemetry());
      telemetryService.recordTelemetry(NODE_ID + 2, telemetry());

      await vi.advanceTimersByTimeAsync(1000);
      await settle();

      expect(seen).toHaveLength(2);
      expect(seen[1].nodes[0].status.telemetryState).toBe(NodeTelemetryState.OK);
    });

    // rxjs recycles its audit timer between windows, which fake timers cannot follow, so this one runs in real time.
    it('stays open through a failed read, for the next reading to fill', async () => {
      findAllNodesMock.mockResolvedValue([{ id: NODE_ID, name: 'gpu-a-01' }]);

      const seen: FleetTelemetryResponseDto[] = [];
      const fleet = await telemetryAdminService.watchFleetTelemetry();

      subscription = fleet.subscribe(response => seen.push(response));

      await settle();

      findAllNodesMock.mockRejectedValueOnce(new Error('connection reset'));
      telemetryService.recordTelemetry(NODE_ID, telemetry());
      await new Promise(resolve => setTimeout(resolve, 1100));
      await settle();

      telemetryService.recordTelemetry(NODE_ID, telemetry());
      await new Promise(resolve => setTimeout(resolve, 1100));
      await settle();

      expect(subscription.closed).toBe(false);
      expect(seen).toHaveLength(2);
    });
  });
});
