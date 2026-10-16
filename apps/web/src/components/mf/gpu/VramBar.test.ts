import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { GpuTelemetryDto } from '@libs/dto';
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

  it('splits what is in use by the process holding it, with what none accounts for as other', () => {
    const bar = mount(VramBar, { props: { devices: [device()], legend: true, processes: true } });

    expect(bar.text()).toContain('modelfleet-01928f3c38 GiB');
    expect(bar.text()).toContain('Other2 GiB');
    expect(bar.text()).toContain('40 GiB free');
    expect(bar.text()).not.toContain('In use');
  });

  it('folds processes of the same name into one band', () => {
    const python = {
      pid: 2,
      usedBytes: 1 * GIB,
      name: '/usr/bin/python3',
      containerId: null,
      containerName: null,
      instanceKey: null,
      deploymentName: null,
    };
    const bar = mount(VramBar, {
      props: {
        devices: [device({ processes: [python, { ...python, pid: 3 }] })],
        legend: true,
        processes: true,
      },
    });

    expect(bar.text()).toContain('python32 GiB');
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

  it("leads with Modelfleet's own instances in the first process tone, what else holds the card following on", () => {
    const external = {
      pid: 9,
      usedBytes: GIB,
      name: '/usr/bin/Xorg',
      containerId: null,
      containerName: null,
      instanceKey: null,
      deploymentName: null,
    };
    const bar = mount(VramBar, {
      props: { devices: [device({ processes: [external, ...device().processes] })], processes: true },
    });

    const bands = bar.findComponent(MfMeter).props('bands') as { label: string; tone: string }[];

    expect(bands.slice(0, 2).map(band => [band.label, band.tone])).toEqual([
      ['modelfleet-01928f3c', PROCESS_METER_TONES[0]],
      ['Xorg', PROCESS_METER_TONES[1]],
    ]);
  });

  it('cycles every process through one palette in order, own then external, wrapping once it runs out', () => {
    const own = (index: number) => ({
      ...device().processes[0],
      pid: 100 + index,
      instanceKey: `01928f3c-0000-7000-8000-00000000010${index}`,
      deploymentName: `deployment-${index}`,
    });
    const external = (index: number) => ({
      pid: 200 + index,
      usedBytes: GIB,
      name: `/usr/bin/app-${index}`,
      containerId: null,
      containerName: null,
      instanceKey: null,
      deploymentName: null,
    });
    const processes = [0, 1, 2, 3, 4].flatMap(index => [own(index), external(index)]);
    const bar = mount(VramBar, {
      props: { devices: [device({ memoryUsedBytes: 80 * GIB, processes })], processes: true },
    });

    const tones = (bar.findComponent(MfMeter).props('bands') as { tone: string }[]).map(band => band.tone);

    expect(tones.slice(0, 10)).toEqual([...PROCESS_METER_TONES, ...PROCESS_METER_TONES].slice(0, 10));
  });

  it('gives a card held only by other processes a different tone for each', () => {
    const external = (name: string, pid: number) => ({
      pid,
      usedBytes: GIB,
      name,
      containerId: null,
      containerName: null,
      instanceKey: null,
      deploymentName: null,
    });
    const processes = [external('/usr/bin/Xorg', 1), external('/usr/bin/kwin', 2), external('/opt/firefox', 3)];
    const bar = mount(VramBar, {
      props: { devices: [device({ memoryUsedBytes: 3 * GIB, processes })], processes: true },
    });

    const bands = bar.findComponent(MfMeter).props('bands') as { label: string; tone: string }[];

    expect(bands.map(band => [band.label, band.tone])).toEqual([
      ['Xorg', PROCESS_METER_TONES[0]],
      ['kwin', PROCESS_METER_TONES[1]],
      ['firefox', PROCESS_METER_TONES[2]],
    ]);
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
