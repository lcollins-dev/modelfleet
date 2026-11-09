import { describe, expect, it } from 'vitest';

import {
  GpuProcessAttribution,
  GpuVendor,
  GpuTelemetryDto,
  GpuProcessDto,
  NodeTelemetryStatusDto,
  PlacementCapacityDto,
  PlacementCardCapacityDto,
  NodeTelemetryState,
} from '@libs/dto';

import {
  attributionTag,
  capacityShares,
  cardFigures,
  capacityFigures,
  describeMemory,
  describeReading,
  pooledCapacity,
  formatTelemetryState,
  gpuName,
  isReadingStale,
  processLabel,
  readingAgeSeconds,
  usageTone,
  vramUsage,
} from './gpu';

const gpu = (overrides: Partial<GpuTelemetryDto> = {}): GpuTelemetryDto => ({
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 3090',
  pciBusId: '0000:01:00.0',
  memoryTotalBytes: 25_757_220_864,
  lastReportedDate: new Date('2026-08-20T12:00:00.000Z'),
  index: 0,
  memoryUsedBytes: 12_878_610_432,
  utilisationPercent: 34,
  temperatureC: 61,
  powerDrawWatts: 220,
  processAttribution: GpuProcessAttribution.EXACT,
  processes: [],
  predictions: [],
  ...overrides,
});

describe('attributionTag', () => {
  it('tags nothing where every device attributes memory exactly, or has not said how', () => {
    expect(attributionTag([gpu(), gpu({ processAttribution: null })])).toBeNull();
  });

  it('tags the whole node where one card reports no per-process memory, naming both causes', () => {
    const tag = attributionTag([gpu(), gpu({ processAttribution: GpuProcessAttribution.UNAVAILABLE })]);

    expect(tag?.label).toBe('Per-process memory unavailable');
    expect(tag?.note).toContain('vendor');
    expect(tag?.note).toContain('pid: host');
  });

  it('tags the whole node as incomplete where one card has a process that did not report', () => {
    const tag = attributionTag([gpu(), gpu({ processAttribution: GpuProcessAttribution.APPROXIMATE })]);

    expect(tag?.label).toBe('Per-process memory incomplete');
    expect(tag?.note).toContain('did not report');
  });

  it('reads unavailable over incomplete, since it covers it', () => {
    const tag = attributionTag([
      gpu({ processAttribution: GpuProcessAttribution.APPROXIMATE }),
      gpu({ processAttribution: GpuProcessAttribution.UNAVAILABLE }),
    ]);

    expect(tag?.label).toBe('Per-process memory unavailable');
  });
});

describe('formatTelemetryState', () => {
  it('reads a node that has reported nothing as having no readings', () => {
    expect(formatTelemetryState(null)).toBe('No readings');
  });

  it('marks a degraded reading', () => {
    expect(formatTelemetryState(NodeTelemetryState.DEGRADED)).toBe('Degraded');
  });

  it('marks a healthy reading as live', () => {
    expect(formatTelemetryState(NodeTelemetryState.OK)).toBe('Live');
  });
});

describe('gpuName', () => {
  it('falls back to the device key where the vendor named nothing', () => {
    expect(gpuName(gpu({ name: null }))).toBe('GPU-4f2c');
  });
});

describe('processLabel', () => {
  const process = (overrides: Partial<GpuProcessDto> = {}): GpuProcessDto => ({
    pid: 12_345,
    usedBytes: 1024,
    name: '/usr/bin/python3.11',
    containerId: null,
    containerName: null,
    instanceKey: null,
    deploymentName: null,
    ...overrides,
  });

  it('names the container where the process belongs to one', () => {
    expect(processLabel(process({ containerName: 'mf-llama-7b' }))).toBe('mf-llama-7b');
  });

  it('keeps the executable rather than the path leading to it', () => {
    expect(processLabel(process())).toBe('python3.11');
  });

  it('falls back to the identifier where the vendor named nothing', () => {
    expect(processLabel(process({ name: null }))).toBe('PID 12345');
  });

  it('leaves a bare name alone', () => {
    expect(processLabel(process({ name: 'steamwebhelper' }))).toBe('steamwebhelper');
  });
});

describe('usageTone', () => {
  it('stays neutral where nothing was reported', () => {
    expect(usageTone(null)).toBe('default');
  });

  it('warns as a device fills', () => {
    expect(usageTone(80)).toBe('warning');
  });

  it('flags a device that is nearly full', () => {
    expect(usageTone(95)).toBe('error');
  });

  it('reads a quiet device as healthy', () => {
    expect(usageTone(10)).toBe('success');
  });
});

describe('vramUsage', () => {
  const GIB = 1024 ** 3;

  const pooled = (memoryUsedBytes: number | null, memoryTotalBytes: number | null) =>
    gpu({ memoryUsedBytes, memoryTotalBytes });

  it('pools the memory of every device given', () => {
    expect(vramUsage([pooled(40 * GIB, 80 * GIB), pooled(10 * GIB, 80 * GIB)])).toEqual({
      usedBytes: 50 * GIB,
      totalBytes: 160 * GIB,
      freeBytes: 110 * GIB,
    });
  });

  it('leaves out a device missing either figure, so its total never counts against nothing used', () => {
    expect(vramUsage([pooled(40 * GIB, 80 * GIB), pooled(null, 80 * GIB)]).totalBytes).toBe(80 * GIB);
  });

  it('never reads free memory below zero where a device reports more used than it holds', () => {
    expect(vramUsage([pooled(90 * GIB, 80 * GIB)]).freeBytes).toBe(0);
  });

  it('reads no devices as zero', () => {
    expect(vramUsage([])).toEqual({ usedBytes: 0, totalBytes: 0, freeBytes: 0 });
  });
});

describe('reading freshness', () => {
  const NOW_MS = new Date('2026-09-22T12:00:20.000Z').getTime();

  const status = (overrides: Partial<NodeTelemetryStatusDto> = {}): NodeTelemetryStatusDto => ({
    telemetryState: NodeTelemetryState.OK,
    capturedAt: new Date('2026-09-22T12:00:17.000Z'),
    receivedAt: new Date('2026-09-22T12:00:17.000Z'),
    host: null,
    devices: [],
    errors: [],
    headroomBytes: 1024 ** 3,
    ...overrides,
  });

  it('ages a reading by when the server received it', () => {
    expect(readingAgeSeconds(status(), NOW_MS)).toBe(3);
    expect(isReadingStale(status(), NOW_MS)).toBe(false);
    expect(describeReading(status(), NOW_MS)).toBe('read 3s ago');
  });

  it('reads a node that has stopped reporting as stale, though its agent is still connected', () => {
    const quiet = status({ receivedAt: new Date('2026-09-22T12:00:00.000Z') });

    expect(isReadingStale(quiet, NOW_MS)).toBe(true);
    expect(describeReading(quiet, NOW_MS)).toBe('reading stale · 20s old');
  });

  it('says a degraded reading is degraded', () => {
    expect(describeReading(status({ telemetryState: NodeTelemetryState.DEGRADED }), NOW_MS)).toBe(
      'degraded, read 3s ago'
    );
  });

  it('gives no age, and no staleness, to a node that has never reported', () => {
    const silent = status({ receivedAt: null });

    expect(readingAgeSeconds(silent, NOW_MS)).toBeNull();
    expect(isReadingStale(silent, NOW_MS)).toBe(false);
    expect(describeReading(silent, NOW_MS)).toBe('waiting for readings');
  });
});

const GIB = 1024 ** 3;

const card = (overrides: Partial<PlacementCardCapacityDto> = {}): Omit<PlacementCardCapacityDto, 'name'> => ({
  deviceKey: 'GPU-4f2c',
  totalBytes: 24 * GIB,
  usedBytes: 4 * GIB,
  predictedBytes: 6 * GIB,
  headroomBytes: GIB,
  freeBytes: 14 * GIB,
  short: false,
  ...overrides,
});

describe('capacityShares', () => {
  it('splits the card into used, starting and headroom, leaving what a start could take', () => {
    expect(capacityShares(card())).toEqual({
      totalBytes: 24 * GIB,
      usedBytes: 4 * GIB,
      startingBytes: 6 * GIB,
      headroomBytes: GIB,
      availableBytes: 13 * GIB,
      overBytes: 0,
    });
  });

  it('keeps headroom whole on a card that has reached it, with nothing over', () => {
    expect(capacityShares(card({ usedBytes: 20 * GIB, predictedBytes: 3 * GIB, freeBytes: GIB }))).toMatchObject({
      headroomBytes: GIB,
      availableBytes: 0,
      overBytes: 0,
    });
  });

  it('lets used and starting eat into headroom once free is gone, before anything runs over', () => {
    expect(
      capacityShares(card({ usedBytes: 20 * GIB, predictedBytes: 3.5 * GIB, freeBytes: 0.5 * GIB }))
    ).toMatchObject({
      headroomBytes: 0.5 * GIB,
      availableBytes: 0,
      overBytes: 0,
    });
  });

  it('keeps used and starting whole on an over-committed card, counting how far past the card they run', () => {
    expect(capacityShares(card({ usedBytes: 20 * GIB, predictedBytes: 6 * GIB, freeBytes: -2 * GIB }))).toEqual({
      totalBytes: 24 * GIB,
      usedBytes: 20 * GIB,
      startingBytes: 6 * GIB,
      headroomBytes: 0,
      availableBytes: 0,
      overBytes: 2 * GIB,
    });
  });

  it('reads nothing as free or over where nothing has been measured, rather than the whole card', () => {
    expect(capacityShares(card({ usedBytes: null, predictedBytes: 0, freeBytes: null }))).toMatchObject({
      usedBytes: null,
      availableBytes: null,
      overBytes: 0,
    });
  });

  it('has no shares for a card whose total is unknown', () => {
    expect(capacityShares(card({ totalBytes: null, freeBytes: null }))).toBeNull();
  });
});

describe('describeMemory', () => {
  const capacity = (overrides: Partial<PlacementCapacityDto> = {}): PlacementCapacityDto => ({
    expectedBytes: 20 * GIB,
    availableBytes: 13 * GIB,
    hostFreeBytes: null,
    cards: [],
    hostWeights: null,
    ...overrides,
  });

  const lines = (overrides: Partial<PlacementCapacityDto> = {}): string[] =>
    describeMemory(capacityFigures(capacity(overrides)));

  it('reads VRAM used against free, a shortfall showing as used over free', () => {
    expect(lines()).toEqual(['VRAM 20 / 13 GiB free']);
  });

  it('adds the weights kept in RAM against what is free for them', () => {
    const hostWeights = { neededBytes: 30 * GIB, cacheBytes: 0, freeBytes: 12 * GIB };

    expect(lines({ availableBytes: 23 * GIB, hostWeights })).toEqual(['VRAM 20 / 23 GiB free', 'RAM 30 / 12 GiB free']);
  });

  it('counts the prompt cache in the RAM figure, marked short', () => {
    const hostWeights = { neededBytes: 8 * GIB, cacheBytes: 8 * GIB, freeBytes: 6 * GIB };

    expect(lines({ availableBytes: 23 * GIB, hostWeights })).toEqual(['VRAM 20 / 23 GiB free', 'RAM 8 / 6 GiB free']);
  });

  it('counts what an offloading start spills past its GPUs as RAM, on top of its weights kept there', () => {
    const hostWeights = { neededBytes: 5 * GIB, cacheBytes: 0, freeBytes: 16 * GIB };

    expect(lines({ availableBytes: 23 * GIB, hostFreeBytes: 16 * GIB, hostWeights })).toEqual([
      'VRAM 7 / 7 GiB free',
      'RAM 18 / 16 GiB free',
    ]);
  });

  it('reads an offloading start that spills into RAM it has room for', () => {
    expect(lines({ availableBytes: 21 * GIB, hostFreeBytes: 8 * GIB })).toEqual([
      'VRAM 13 / 13 GiB free',
      'RAM 7 / 8 GiB free',
    ]);
  });

  it('leaves out the RAM line of an offloading start its GPUs hold whole', () => {
    expect(lines({ availableBytes: 32 * GIB, hostFreeBytes: 8 * GIB })).toEqual(['VRAM 20 / 24 GiB free']);
  });

  it('reads a pool the node has not reported as a dash, not zero', () => {
    expect(lines({ availableBytes: null })).toEqual(['VRAM 20 GiB / -']);
  });

  it("reads the whole need as VRAM where an offloading start's GPUs have not reported", () => {
    const hostWeights = { neededBytes: 5 * GIB, cacheBytes: 0, freeBytes: 8 * GIB };

    expect(lines({ availableBytes: null, hostFreeBytes: 8 * GIB, hostWeights })).toEqual([
      'VRAM 20 GiB / -',
      'RAM 5 / 8 GiB free',
    ]);
  });

  it('keeps both units where they differ', () => {
    expect(lines({ expectedBytes: 512 * 1024 ** 2 })).toEqual(['VRAM 512 MiB / 13 GiB free']);
  });

  it('shows only the RAM used where nothing says what is free', () => {
    const figures = { vramUsedBytes: 20 * GIB, vramFreeBytes: null, ramUsedBytes: 4 * GIB, ramFreeBytes: null };

    expect(describeMemory(figures)).toEqual(['VRAM 20 GiB / -', 'RAM 4 GiB / -']);
  });
});

describe('cardFigures', () => {
  it("reads a device with the node's headroom and everything predicted on it, as admission does", () => {
    const device = gpu({
      memoryTotalBytes: 24 * GIB,
      memoryUsedBytes: 8 * GIB,
      predictions: [
        { instanceKey: 'a', deploymentName: 'qwen', bytes: 2 * GIB },
        { instanceKey: 'b', deploymentName: null, bytes: GIB },
      ],
    });

    expect(cardFigures(device, GIB)).toEqual({
      totalBytes: 24 * GIB,
      usedBytes: 8 * GIB,
      predictedBytes: 3 * GIB,
      headroomBytes: GIB,
    });
    expect(capacityShares(cardFigures(device, GIB))?.availableBytes).toBe(12 * GIB);
  });
});

describe('pooledCapacity', () => {
  const loading = (deploymentName: string | null, gib: number) => ({
    instanceKey: '01928f3c-0000-7000-8000-00000000000f',
    deploymentName,
    bytes: gib * GIB,
  });

  const measured = (usedGib: number, predictions: ReturnType<typeof loading>[] = []) =>
    gpu({ memoryTotalBytes: 24 * GIB, memoryUsedBytes: usedGib * GIB, predictions });

  it('pools what each deployment is starting, the headroom and what is free across the devices', () => {
    expect(
      pooledCapacity([measured(4, [loading('qwen-coder', 6)]), measured(4, [loading('qwen-coder', 2)])], GIB)
    ).toEqual({
      starting: [{ deploymentName: 'qwen-coder', bytes: 8 * GIB }],
      headroomBytes: 2 * GIB,
      availableBytes: 30 * GIB,
      overBytes: 0,
    });
  });

  it('keeps what is starting whole on a card it overruns, counting the overrun apart', () => {
    expect(pooledCapacity([measured(20, [loading('qwen-coder', 3), loading('llama-70b-chat', 3)])], GIB)).toEqual({
      starting: [
        { deploymentName: 'qwen-coder', bytes: 3 * GIB },
        { deploymentName: 'llama-70b-chat', bytes: 3 * GIB },
      ],
      headroomBytes: 0,
      availableBytes: 0,
      overBytes: 2 * GIB,
    });
  });

  it("counts one card's overrun however much another has free, since a start cannot move it", () => {
    expect(pooledCapacity([measured(20, [loading('qwen-coder', 6)]), measured(4)], GIB)).toMatchObject({
      availableBytes: 19 * GIB,
      overBytes: 2 * GIB,
    });
  });

  it('leaves out a device with nothing measured, as the in-use pool does', () => {
    expect(pooledCapacity([measured(4, [loading(null, 6)]), gpu({ memoryUsedBytes: null })], GIB)).toEqual({
      starting: [{ deploymentName: null, bytes: 6 * GIB }],
      headroomBytes: GIB,
      availableBytes: 13 * GIB,
      overBytes: 0,
    });
  });
});
