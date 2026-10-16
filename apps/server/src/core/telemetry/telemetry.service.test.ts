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
