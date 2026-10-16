import { describe, expect, it } from 'vitest';

import { GPU_SNAPSHOT_SCHEMA_VERSION, deviceKeyOf, parseGpuSnapshot } from '@/telemetry/device-reader/gpu-snapshot';

const device = () => ({
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
  processes: [{ pid: 12345, usedBytes: 21_340_618_752 }],
});

const snapshot = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: GPU_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: '2026-08-20T12:00:00.000Z',
    devices: [device()],
    errors: [],
    ...overrides,
  });

describe('parseGpuSnapshot', () => {
  it('reads a snapshot in the documented shape', () => {
    const result = parseGpuSnapshot(snapshot());

    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.devices[0].uuid).toBe('GPU-4f2c');
    expect(result.ok && result.snapshot.devices[0].processes[0].pid).toBe(12345);
  });

  it('refuses a schema version it does not know', () => {
    const result = parseGpuSnapshot(snapshot({ schema: GPU_SNAPSHOT_SCHEMA_VERSION + 1 }));

    expect(result.ok).toBe(false);
    expect(result.ok || result.reason).toContain(String(GPU_SNAPSHOT_SCHEMA_VERSION + 1));
  });

  it('refuses a line carrying no schema version at all', () => {
    const result = parseGpuSnapshot(JSON.stringify({ devices: [], errors: [] }));

    expect(result.ok).toBe(false);
  });

  it('refuses a line that is not json', () => {
    const result = parseGpuSnapshot('mf-gpu: nvml is unavailable');

    expect(result.ok).toBe(false);
  });

  it('refuses a snapshot whose device is malformed rather than reading part of it', () => {
    const result = parseGpuSnapshot(snapshot({ devices: [{ ...device(), processAttribution: 'guessed' }] }));

    expect(result.ok).toBe(false);
  });

  it('reads a machine with no devices as a valid snapshot', () => {
    const result = parseGpuSnapshot(snapshot({ devices: [] }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.devices).toHaveLength(0);
  });

  it('leaves a metric the vendor could not supply absent', () => {
    const sparse = { ...device(), temperatureC: undefined, powerDrawWatts: undefined };
    const result = parseGpuSnapshot(snapshot({ devices: [sparse] }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.devices[0].temperatureC).toBeUndefined();
  });

  it('reads the errors a partial reading reported', () => {
    const errors = [
      { scope: 'metric', vendor: 'nvidia', device: 'GPU-4f2c', metric: 'temperature', message: 'read failed' },
    ];
    const result = parseGpuSnapshot(snapshot({ errors }));

    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.errors[0].metric).toBe('temperature');
  });
});

describe('deviceKeyOf', () => {
  it('is the uuid the vendor gives', () => {
    expect(deviceKeyOf({ uuid: 'GPU-4f2c' })).toBe('GPU-4f2c');
  });

  it('is absent where the vendor gives no uuid, whatever slot the device sits in', () => {
    expect(deviceKeyOf({ uuid: undefined })).toBeNull();
  });
});
