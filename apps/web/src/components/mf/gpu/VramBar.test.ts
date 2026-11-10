import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { GpuProcessDto, GpuTelemetryDto } from '@libs/dto';
import { GpuProcessAttribution, GpuVendor } from '@libs/dto';

import MfMeter from '../Meter.vue';
import { PROCESS_METER_TONES } from '../meterTone';
import VramBar from './VramBar.vue';

const GIB = 1024 ** 3;

const device = (overrides: Partial<GpuTelemetryDto> = {}): GpuTelemetryDto => ({
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA A100-SXM4-80GB',
  pciBusId: null,
  memoryTotalBytes: 80 * GIB,
  lastReportedDate: new Date('2026-09-22T12:00:00.000Z'),
  index: 0,
  memoryUsedBytes: 40 * GIB,
  utilisationPercent: null,
  temperatureC: null,
  powerDrawWatts: null,
  processAttribution: GpuProcessAttribution.EXACT,
  processes: [
    {
      pid: 1,
      usedBytes: 38 * GIB,
      name: '/app/llama-server',
      containerId: 'abc',
      containerName: 'modelfleet-01928f3c',
      instanceKey: '01928f3c-0000-7000-8000-000000000000',
      deploymentName: null,
    },
  ],
  predictions: [],
  ...overrides,
});

const loading = (deploymentName: string | null, bytes: number) => ({
  instanceKey: '01928f3c-0000-7000-8000-00000000000f',
  deploymentName,
  bytes,
});

const outside = (name: string, usedBytes: number | null): GpuProcessDto => ({
  pid: 9,
  usedBytes,
  name,
  containerId: null,
  containerName: null,
  instanceKey: null,
  deploymentName: null,
});

interface IBand {
  label: string;
  tone: string;
  percent: number;
  value?: string;
  hoverNote?: string;
}

const mountBar = (props: Record<string, unknown>) => mount(VramBar, { props: { devices: [], ...props } });

const bandsOf = (bar: ReturnType<typeof mountBar>): IBand[] => bar.findComponent(MfMeter).props('bands') as IBand[];

describe('MfGpuVramBar', () => {
  it('pools the devices it is given, in use against total and what is free', () => {
    const bar = mount(VramBar, { props: { devices: [device(), device({ deviceKey: 'GPU-9a1b' })], legend: true } });

    expect(bar.text()).toContain('80 GiB of 160 GiB');
    expect(bar.text()).toContain('80 GiB free');
  });

  it('keeps to in use and free unless asked for processes', () => {
    const bar = mount(VramBar, { props: { devices: [device()], legend: true } });

    expect(bar.text()).toContain('In use');
    expect(bar.text()).not.toContain('modelfleet-01928f3c');
  });

  it('names what is free beside the total only alongside its legend', () => {
    const bare = mount(VramBar, { props: { devices: [device()] } });

    expect(bare.text()).toBe('40 GiB of 80 GiB');
  });

  it('marks headroom in the strong line tone and what is starting as pending', () => {
    const bar = mount(VramBar, {
      props: { devices: [device({ predictions: [loading('qwen-coder', 6 * GIB)] })], headroomBytes: GIB },
    });

    const bands = bar.findComponent(MfMeter).props('bands') as { label: string; tone: string }[];

    expect(bands.map(band => [band.label, band.tone])).toEqual([
      ['Headroom', 'strong'],
      ['In use', 'primary'],
      ['qwen-coder (starting)', 'pending'],
    ]);
  });

  it('splits what is in use by deployment, with what none accounts for as other', () => {
    const bar = mount(VramBar, { props: { devices: [device()], legend: true, processes: true } });

    expect(bar.text()).toContain('modelfleet-01928f3c38 GiB');
    expect(bar.text()).toContain('Other2 GiB');
    expect(bar.text()).toContain('40 GiB free');
    expect(bar.text()).not.toContain('In use');
  });

  it('folds the instances of one deployment into one band', () => {
    const serving = { ...device().processes[0], deploymentName: 'qwen-coder' };
    const bar = mountBar({
      devices: [device({ processes: [serving, { ...serving, pid: 2, usedBytes: 2 * GIB }] })],
      legend: true,
      processes: true,
    });

    expect(bar.text()).toContain('qwen-coder40 GiB');
    expect(bandsOf(bar).map(band => band.label)).toEqual(['qwen-coder']);
  });

  it('gives an outside process no band, rolling it into other with what no process accounts for', () => {
    const bar = mountBar({
      devices: [device({ processes: [outside('/usr/bin/Xorg', 1 * GIB), ...device().processes] })],
      legend: true,
      processes: true,
    });

    expect(bandsOf(bar).map(band => [band.label, band.value])).toEqual([
      ['modelfleet-01928f3c', '38 GiB'],
      ['Other', '2 GiB'],
    ]);
  });

  it('lists each outside process with its memory on hovering other, the most memory first', () => {
    const processes = [outside('/usr/bin/ollama', 8 * GIB), outside('/usr/bin/python', 12 * GIB)];
    const bar = mountBar({ devices: [device({ processes })], legend: true, processes: true });

    expect(bandsOf(bar)).toEqual([expect.objectContaining({ label: 'Other', value: '40 GiB' })]);
    expect(bandsOf(bar)[0].hoverNote).toBe('python 12 GiB, ollama 8 GiB');
  });

  it('keeps other and its list where the deployments read a moment after the card total more than its used', () => {
    const processes = [outside('/usr/bin/python', 2 * GIB), ...device().processes];
    const bar = mountBar({ devices: [device({ memoryUsedBytes: 30 * GIB, processes })], processes: true });

    expect(bandsOf(bar)[1]).toMatchObject({ label: 'Other', value: '0 B', percent: 0, hoverNote: 'python 2 GiB' });
  });

  it('pools the list across devices, leaving out a device whose memory was not measured', () => {
    const measured = (name: string) => device({ memoryUsedBytes: 5 * GIB, processes: [outside(name, 5 * GIB)] });
    const unmeasured = device({ memoryUsedBytes: null, processes: [outside('/usr/bin/blender', 12 * GIB)] });
    const bar = mountBar({
      devices: [measured('/usr/bin/python'), measured('/usr/bin/ollama'), unmeasured],
      processes: true,
    });

    expect(bandsOf(bar)).toEqual([
      expect.objectContaining({ label: 'Other', value: '10 GiB', hoverNote: 'python 5 GiB, ollama 5 GiB' }),
    ]);
  });

  it('keeps the band of a deployment that reported no memory, reading as unknown', () => {
    const serving = { ...device().processes[0], deploymentName: 'qwen-coder', usedBytes: null };
    const bar = mountBar({ devices: [device({ processes: [serving] })], processes: true });

    expect(bandsOf(bar).map(band => [band.label, band.value, band.percent])).toEqual([
      ['qwen-coder', 'Unknown', 0],
      ['Other', '40 GiB', 50],
    ]);
  });

  it('folds outside processes of the same name in that list, still naming one that reported no memory', () => {
    const processes = [
      outside('/usr/bin/python', 1 * GIB),
      outside('/usr/bin/python', 1 * GIB),
      outside('/usr/bin/Xorg', null),
    ];
    const bar = mountBar({ devices: [device({ processes })], processes: true });

    expect(bandsOf(bar)[0].hoverNote).toBe('python 2 GiB, Xorg unknown');
  });

  it('gives other no process list with no outside processes reported', () => {
    const held = mountBar({ devices: [device()], legend: true, processes: true });
    const unlisted = mountBar({ devices: [device({ processes: [] })], legend: true, processes: true });

    expect(bandsOf(held)[1]).toMatchObject({ label: 'Other', value: '2 GiB' });
    expect(bandsOf(held)[1].hoverNote).toBeUndefined();
    expect(bandsOf(unlisted)[0].hoverNote).toBeUndefined();
  });

  it('keeps the headroom and starting bands either side of the deployments and other', () => {
    const bar = mountBar({
      devices: [
        device({
          processes: [outside('/usr/bin/python', GIB), ...device().processes],
          predictions: [loading('qwen-coder', 6 * GIB)],
        }),
      ],
      processes: true,
      headroomBytes: GIB,
    });

    expect(bandsOf(bar).map(band => [band.label, band.tone])).toEqual([
      ['Headroom', 'strong'],
      ['modelfleet-01928f3c', PROCESS_METER_TONES[0]],
      ['Other', 'muted'],
      ['qwen-coder (starting)', 'pending'],
    ]);
  });

  it('still names the total of a device read for it but not yet for its use', () => {
    const bar = mount(VramBar, { props: { devices: [device({ memoryUsedBytes: null })] } });

    expect(bar.text()).toContain('80 GiB total');
    expect(bar.text()).not.toContain('free');
  });

  it('leads with the headroom, then what is in use, what is starting and what is free', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ predictions: [loading('qwen-coder', 6 * GIB)] })],
        legend: true,
        processes: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).toContain('modelfleet-01928f3c38 GiB');
    expect(bar.text()).toContain('qwen-coder (starting)6 GiB');
    expect(bar.text()).toContain('Headroom1 GiB');
    expect(bar.text()).toContain('33 GiB free');
    expect(bar.text().indexOf('Headroom')).toBeLessThan(bar.text().indexOf('modelfleet-01928f3c'));
    expect(bar.text().indexOf('modelfleet-01928f3c')).toBeLessThan(bar.text().indexOf('qwen-coder'));
  });

  it('keeps used and starting whole on an over-committed card, running the bar past its end by the overrun', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ memoryUsedBytes: 78 * GIB, predictions: [loading(null, 6 * GIB)] })],
        legend: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).toContain('Starting6 GiB');
    expect(bar.text()).toContain('Headroom0 B');
    expect(bar.text()).toContain('0 B free');
    expect(bar.text()).toContain('Over4 GiB');
    expect(bar.find('[data-overflow]').attributes('style')).toContain(`left: ${(80 / 84) * 100}%`);
  });

  it('eats into headroom once free is gone, before marking any overflow', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ memoryUsedBytes: 75 * GIB, predictions: [loading(null, 4.5 * GIB)] })],
        legend: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).toContain('Headroom512 MiB');
    expect(bar.text()).toContain('0 B free');
    expect(bar.find('[data-overflow]').exists()).toBe(false);
  });

  it('marks no overflow on a card with room to spare', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ predictions: [loading('qwen-coder', 6 * GIB)] })],
        legend: true,
        processes: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).not.toContain('Over');
    expect(bar.find('[data-overflow]').exists()).toBe(false);
  });

  it('marks no overflow where the processes read a moment after the card total more than its used', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ memoryUsedBytes: 30 * GIB })],
        legend: true,
        processes: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).toContain('modelfleet-01928f3c38 GiB');
    expect(bar.find('[data-overflow]').exists()).toBe(false);
  });

  it('reads headroom as a dash and names nothing free before the device has been measured, with nothing starting', () => {
    const bar = mount(VramBar, {
      props: {
        devices: [device({ memoryUsedBytes: null })],
        legend: true,
        headroomBytes: GIB,
      },
    });

    expect(bar.text()).not.toContain('Starting');
    expect(bar.text()).toContain('Headroom-');
    expect(bar.text()).not.toContain('free');
  });

  it('cycles every deployment through one palette in order, wrapping once it runs out', () => {
    const serving = (index: number) => ({
      ...device().processes[0],
      pid: 100 + index,
      usedBytes: GIB,
      instanceKey: `01928f3c-0000-7000-8000-0000000001${index.toString().padStart(2, '0')}`,
      deploymentName: `deployment-${index}`,
    });
    const processes = Array.from({ length: PROCESS_METER_TONES.length + 2 }, (_unused, index) => serving(index));
    const bar = mountBar({ devices: [device({ memoryUsedBytes: 80 * GIB, processes })], processes: true });

    expect(bandsOf(bar).map(band => band.tone)).toEqual([
      ...PROCESS_METER_TONES,
      ...PROCESS_METER_TONES.slice(0, 2),
      'muted',
    ]);
  });

  it('reads a card held only by outside processes as other alone', () => {
    const processes = [outside('/usr/bin/Xorg', GIB), outside('/usr/bin/kwin', GIB)];
    const bar = mountBar({ devices: [device({ memoryUsedBytes: 2 * GIB, processes })], processes: true });

    expect(bandsOf(bar).map(band => [band.label, band.tone])).toEqual([['Other', 'muted']]);
  });

  it('splits what is starting by deployment, and shows no starting band where nothing is loading', () => {
    const starting = mount(VramBar, {
      props: {
        devices: [device({ predictions: [loading('qwen-coder', 4 * GIB), loading('llama-70b-chat', 2 * GIB)] })],
        legend: true,
        headroomBytes: GIB,
      },
    });
    const idle = mount(VramBar, { props: { devices: [device()], legend: true, headroomBytes: GIB } });

    expect(starting.text()).toContain('qwen-coder (starting)4 GiB');
    expect(starting.text()).toContain('llama-70b-chat (starting)2 GiB');
    expect(idle.text()).not.toContain('starting');
    expect(idle.text()).not.toContain('Starting');
  });

  it('names a Modelfleet process by its deployment, and calls memory no process holds other', () => {
    const serving = { ...device().processes[0], deploymentName: 'qwen-coder' };
    const named = mount(VramBar, {
      props: { devices: [device({ processes: [serving] })], legend: true, processes: true },
    });
    const unlisted = mount(VramBar, { props: { devices: [device({ processes: [] })], legend: true, processes: true } });

    expect(named.text()).toContain('qwen-coder38 GiB');
    expect(named.text()).not.toContain('modelfleet-01928f3c');
    expect(unlisted.text()).toContain('Other40 GiB');
    expect(unlisted.text()).not.toContain('In use');
  });
});
