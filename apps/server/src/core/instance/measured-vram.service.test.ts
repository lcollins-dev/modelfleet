import { Subject } from 'rxjs';
import { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GpuDeviceMetrics, GpuProcess, InstanceState, ProcessAttribution } from '@libs/agent-protocol';
import { GIB } from '@libs/backends';

import { Instance } from '@/core/instance/entities/instance.entity';
import { MeasuredVram } from '@/core/instance/entities/measured-vram.entity';

import { MeasuredVramService } from '@/core/instance/measured-vram.service';
import { INodeTelemetry, TelemetryService } from '@/core/telemetry/telemetry.service';

import { buildDeployment, TEST_REVISION } from '@/test/deployment.factory';
import { buildInstance, TEST_DEVICE_KEY, TEST_INSTANCE_KEY } from '@/test/instance.factory';
import { TEST_NODE_ID } from '@/test/node.factory';

const SECOND_DEVICE_KEY = 'GPU-99999999-2222-3333-4444-555555555555';
const OTHER_INSTANCE_KEY = '01999999-2222-7222-8222-222222222222';

const settled = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

describe('MeasuredVramService', () => {
  let changes: Subject<number>;
  let devices: GpuDeviceMetrics[];
  let instances: Instance[];
  let find: ReturnType<typeof vi.fn>;
  let findOneBy: ReturnType<typeof vi.fn>;
  let writes: number[];
  let service: MeasuredVramService;

  const process = (usedBytes: number | null, instanceKey: string | null = TEST_INSTANCE_KEY): GpuProcess => ({
    pid: 4242,
    usedBytes,
    name: 'llama-server',
    containerId: 'abc123',
    containerName: 'mf-llama',
    instanceKey,
  });

  const card = (overrides: Partial<GpuDeviceMetrics> = {}): GpuDeviceMetrics => ({
    deviceKey: TEST_DEVICE_KEY,
    index: 0,
    memoryUsedBytes: 8 * GIB,
    utilisationPercent: null,
    temperatureC: null,
    powerDrawWatts: null,
    processAttribution: ProcessAttribution.EXACT,
    processes: [process(8 * GIB)],
    ...overrides,
  });

  const ready = (gpus = [TEST_DEVICE_KEY], cpu = false): Instance =>
    buildInstance({ instanceState: InstanceState.READY, pins: { cpu, gpus }, deployment: buildDeployment() });

  const reading = async (...read: GpuDeviceMetrics[]): Promise<void> => {
    devices = read;
    changes.next(TEST_NODE_ID);

    await settled();
  };

  /** Two, since the first reading after an instance reads ready is never measured. */
  const readings = async (...read: GpuDeviceMetrics[]): Promise<void> => {
    await reading(...read);
    await reading(...read);
  };

  beforeEach(() => {
    changes = new Subject<number>();
    devices = [];
    instances = [ready()];
    find = vi.fn(() => Promise.resolve(instances));
    findOneBy = vi.fn(() => Promise.resolve(null));
    writes = [];

    const insert = vi.fn((row: MeasuredVram) => Promise.resolve(writes.push(row.bytes)));
    const update = vi.fn((_where: unknown, changed: { bytes: number }) => Promise.resolve(writes.push(changed.bytes)));

    const telemetryService = new TelemetryService();

    vi.spyOn(telemetryService, 'telemetryChanged').mockReturnValue(changes.asObservable());
    vi.spyOn(telemetryService, 'getTelemetry').mockImplementation(() => ({ devices }) as INodeTelemetry);

    service = new MeasuredVramService(
      telemetryService,
      { find } as unknown as Repository<Instance>,
      { findOneBy, insert, update } as unknown as Repository<MeasuredVram>
    );

    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it("records a ready instance's total against its configuration and card count", async () => {
    await readings(card());

    expect(findOneBy).toHaveBeenCalledWith({ configurationRevision: TEST_REVISION, gpuCount: 1 });
    expect(writes).toEqual([8 * GIB]);
  });

  it('skips the first reading after an instance reads ready, which may predate the load', async () => {
    await reading(card());

    expect(writes).toEqual([]);
  });

  it('records nothing for an instance whose deployment has an edit not yet applied', async () => {
    instances = [ready()];
    instances[0].deployment = buildDeployment({ configurationRevision: 'b'.repeat(64) });

    await readings(card());

    expect(writes).toEqual([]);
  });

  it('writes nothing below a figure already stored, as one from before a restart', async () => {
    findOneBy.mockResolvedValue({ bytes: 9 * GIB });

    await readings(card());

    expect(writes).toEqual([]);
  });

  it("totals an instance's processes across every card it holds, and no one else's", async () => {
    instances = [ready([TEST_DEVICE_KEY, SECOND_DEVICE_KEY])];

    await readings(
      card({ processes: [process(5 * GIB), process(3 * GIB, OTHER_INSTANCE_KEY), process(2 * GIB, null)] }),
      card({ deviceKey: SECOND_DEVICE_KEY, index: 1, processes: [process(4 * GIB)] })
    );

    expect(findOneBy).toHaveBeenCalledWith({ configurationRevision: TEST_REVISION, gpuCount: 2 });
    expect(writes).toEqual([9 * GIB]);
  });

  it('records nothing for an instance that may offload to the cpu', async () => {
    instances = [ready([TEST_DEVICE_KEY], true)];

    await readings(card());

    expect(writes).toEqual([]);
  });

  it.each([ProcessAttribution.APPROXIMATE, ProcessAttribution.UNAVAILABLE])(
    'records nothing from a card whose attribution is %s',
    async processAttribution => {
      await readings(card({ processAttribution }));

      expect(writes).toEqual([]);
    }
  );

  it('records nothing where one of the pinned cards is missing from the reading', async () => {
    instances = [ready([TEST_DEVICE_KEY, SECOND_DEVICE_KEY])];

    await readings(card());

    expect(writes).toEqual([]);
  });

  it("records nothing where a pinned card shows none of the instance's processes yet", async () => {
    instances = [ready([TEST_DEVICE_KEY, SECOND_DEVICE_KEY])];

    await readings(card(), card({ deviceKey: SECOND_DEVICE_KEY, index: 1, processes: [process(4 * GIB, null)] }));

    expect(writes).toEqual([]);
  });

  it('records nothing where a process of the instance has no figure', async () => {
    await readings(card({ processes: [process(8 * GIB), process(null)] }));

    expect(writes).toEqual([]);
  });

  it('asks nothing of the database for a reading no instance holds memory in', async () => {
    const fromOlderAgent: GpuProcess = {
      pid: 4343,
      usedBytes: GIB,
      name: null,
      containerId: null,
      containerName: null,
    };

    await readings(card({ processes: [process(8 * GIB, null), fromOlderAgent] }));

    expect(find).not.toHaveBeenCalled();
  });

  it('writes again only when the measurement rises', async () => {
    await readings(card());
    await readings(card({ processes: [process(7 * GIB)] }));
    await readings(card());
    await readings(card({ processes: [process(10 * GIB)] }));

    expect(writes).toEqual([8 * GIB, 10 * GIB]);
  });

  it('remembers nothing for pins that may offload to the cpu', async () => {
    findOneBy.mockResolvedValue({ bytes: 12 * GIB });

    expect(await service.rememberedFor(TEST_REVISION, { cpu: true, gpus: [TEST_DEVICE_KEY] })).toBeNull();
  });
});
