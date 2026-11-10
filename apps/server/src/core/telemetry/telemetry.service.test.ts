import { beforeEach, describe, expect, it } from 'vitest';

import { AgentTelemetry, ProcessAttribution, TelemetryErrorScope, TelemetryState } from '@libs/agent-protocol';

import { TelemetryService } from '@/core/telemetry/telemetry.service';

const NODE_ID = 7;

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
      processes: [],
    },
  ],
  host: { cpuModel: null, cpuCount: 8, loadAverage1m: 1.2, memoryTotalBytes: 16, memoryFreeBytes: 8 },
  errors: [],
  ...overrides,
});

describe('TelemetryService', () => {
  let telemetryService: TelemetryService;

  beforeEach(() => {
    telemetryService = new TelemetryService();
  });

  describe('measuredUsage', () => {
    const FIRST_KEY = '6f1c2d3e-0000-4000-8000-000000000001';
    const SECOND_KEY = '6f1c2d3e-0000-4000-8000-000000000002';
    const CARD_A = 'GPU-a';
    const CARD_B = 'GPU-b';

    const process = (instanceKey: string, usedBytes: number | null) => ({
      pid: 1,
      usedBytes,
      name: null,
      containerId: null,
      containerName: null,
      instanceKey,
    });

    const device = (
      deviceKey: string,
      processes: ReturnType<typeof process>[],
      processAttribution = ProcessAttribution.EXACT
    ) => ({
      deviceKey,
      index: 0,
      memoryUsedBytes: null,
      utilisationPercent: null,
      temperatureC: null,
      powerDrawWatts: null,
      processAttribution,
      processes,
    });

    const host = (instanceMemory: { instanceKey: string; heldBytes: null; residentBytes: number | null }[]) => ({
      cpuModel: null,
      cpuCount: 8,
      loadAverage1m: null,
      memoryTotalBytes: 16,
      memoryFreeBytes: 8,
      instanceMemory,
    });

    const resident = (instanceKey: string, residentBytes: number | null) => ({
      instanceKey,
      heldBytes: null,
      residentBytes,
    });

    const first = { instanceKey: FIRST_KEY, gpus: [CARD_A, CARD_B] };
    const second = { instanceKey: SECOND_KEY, gpus: [CARD_A, CARD_B] };

    it('sums what the instances hold across their cards and in RAM', () => {
      telemetryService.recordTelemetry(
        NODE_ID,
        telemetry({
          devices: [
            device(CARD_A, [process(FIRST_KEY, 10), process(SECOND_KEY, 20)]),
            device(CARD_B, [process(FIRST_KEY, 5)]),
          ],
          host: host([resident(FIRST_KEY, 100), resident(SECOND_KEY, 200)]),
        })
      );

      expect(telemetryService.measuredUsage(NODE_ID, [first, second])).toEqual({ vramBytes: 35, ramBytes: 300 });
    });

    it('counts a pinned card holding none of the instance as nothing', () => {
      telemetryService.recordTelemetry(
        NODE_ID,
        telemetry({ devices: [device(CARD_A, [process(FIRST_KEY, 10)]), device(CARD_B, [])], host: host([]) })
      );

      expect(telemetryService.measuredUsage(NODE_ID, [first]).vramBytes).toBe(10);
    });

    it('is blank for a node with no reading', () => {
      expect(telemetryService.measuredUsage(NODE_ID, [first])).toEqual({ vramBytes: null, ramBytes: null });
    });

    it.each([
      ['has no process on any card yet', [device(CARD_A, []), device(CARD_B, [])]],
      [
        'holds a process with no figure',
        [device(CARD_A, [process(FIRST_KEY, null)], ProcessAttribution.APPROXIMATE), device(CARD_B, [])],
      ],
      [
        'is on a card only partly attributed',
        [device(CARD_A, [process(FIRST_KEY, 10)], ProcessAttribution.APPROXIMATE), device(CARD_B, [])],
      ],
      ['is pinned to a card the node has stopped reporting', [device(CARD_A, [process(FIRST_KEY, 10)])]],
      [
        'is pinned to a card whose processes cannot be seen',
        [device(CARD_A, [process(FIRST_KEY, 10)]), device(CARD_B, [], ProcessAttribution.UNAVAILABLE)],
      ],
    ])('leaves VRAM blank for an instance that %s', (_case, devices) => {
      telemetryService.recordTelemetry(NODE_ID, telemetry({ devices, host: host([resident(FIRST_KEY, 100)]) }));

      expect(telemetryService.measuredUsage(NODE_ID, [first])).toEqual({ vramBytes: null, ramBytes: 100 });
    });

    it('leaves a figure blank when any one instance has no reading for it, rather than reading short', () => {
      telemetryService.recordTelemetry(
        NODE_ID,
        telemetry({
          devices: [device(CARD_A, [process(FIRST_KEY, 10)]), device(CARD_B, [])],
          host: host([resident(FIRST_KEY, 100), resident(SECOND_KEY, null)]),
        })
      );

      expect(telemetryService.measuredUsage(NODE_ID, [first, second])).toEqual({ vramBytes: null, ramBytes: null });
    });

    it('leaves RAM blank for an agent that does not report it', () => {
      telemetryService.recordTelemetry(
        NODE_ID,
        telemetry({ devices: [device(CARD_A, [process(FIRST_KEY, 10)]), device(CARD_B, [])] })
      );

      expect(telemetryService.measuredUsage(NODE_ID, [first])).toEqual({ vramBytes: 10, ramBytes: null });
    });

    it('leaves VRAM blank for an instance on no cards', () => {
      telemetryService.recordTelemetry(NODE_ID, telemetry({ host: host([resident(FIRST_KEY, 100)]) }));

      expect(telemetryService.measuredUsage(NODE_ID, [{ instanceKey: FIRST_KEY, gpus: [] }])).toEqual({
        vramBytes: null,
        ramBytes: 100,
      });
    });
  });

  it('answers with the last reading a node sent', () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    expect(telemetryService.getTelemetry(NODE_ID)?.devices[0].utilisationPercent).toBe(34);
  });

  it('replaces the previous reading rather than accumulating them', () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry());
    telemetryService.recordTelemetry(NODE_ID, telemetry({ capturedAt: '2026-08-20T12:00:05.000Z' }));

    expect(telemetryService.getTelemetry(NODE_ID)?.capturedAt).toBe('2026-08-20T12:00:05.000Z');
  });

  it('keeps the reading of one node apart from another', () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry());

    expect(telemetryService.getTelemetry(NODE_ID + 1)).toBeNull();
  });

  it('has no reading for a node that has reported nothing', () => {
    expect(telemetryService.getTelemetry(NODE_ID)).toBeNull();
  });

  it('holds a degraded reading like any other', () => {
    telemetryService.recordTelemetry(
      NODE_ID,
      telemetry({
        telemetryState: TelemetryState.DEGRADED,
        devices: [],
        errors: [{ scope: TelemetryErrorScope.PROVIDER, deviceKey: null, metric: null, message: 'the reader exited' }],
      })
    );

    expect(telemetryService.getTelemetry(NODE_ID)?.telemetryState).toBe(TelemetryState.DEGRADED);
  });

  it('drops a reading once the node is forgotten', () => {
    telemetryService.recordTelemetry(NODE_ID, telemetry());
    telemetryService.forget(NODE_ID);

    expect(telemetryService.getTelemetry(NODE_ID)).toBeNull();
  });
  describe('what an instance holds on a card', () => {
    const INSTANCE_KEY = '01999999-0000-7000-8000-000000000001';

    const card = (processes: { instanceKey: string | null; usedBytes: number | null }[]) => ({
      ...telemetry().devices[0],
      processes: processes.map((process, pid) => ({
        pid,
        name: null,
        containerId: null,
        containerName: null,
        ...process,
      })),
    });

    it("totals every process labelled with the instance, and no other's", () => {
      const device = card([
        { instanceKey: INSTANCE_KEY, usedBytes: 3 },
        { instanceKey: INSTANCE_KEY, usedBytes: 2 },
        { instanceKey: null, usedBytes: 7 },
        { instanceKey: null, usedBytes: null },
      ]);

      expect(telemetryService.heldBy(device, INSTANCE_KEY)).toBe(5);
    });

    it('has no total where none of its processes is on the card', () => {
      expect(telemetryService.heldBy(card([{ instanceKey: null, usedBytes: 7 }]), INSTANCE_KEY)).toBeNull();
    });

    it('has no total where one of its processes carries no figure, since it would read short', () => {
      const device = card([
        { instanceKey: INSTANCE_KEY, usedBytes: 3 },
        { instanceKey: INSTANCE_KEY, usedBytes: null },
      ]);

      expect(telemetryService.heldBy(device, INSTANCE_KEY)).toBeNull();
    });
  });
});
