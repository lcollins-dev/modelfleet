import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import type { GpuTelemetryDto } from '@libs/dto';
import { GpuProcessAttribution, GpuVendor } from '@libs/dto';

import DeviceRow from './DeviceRow.vue';

const GIB = 1024 ** 3;

const device: GpuTelemetryDto = {
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA GeForce RTX 5090',
  pciBusId: '00000000:01:00.0',
  memoryTotalBytes: 32 * GIB,
  lastReportedDate: new Date('2026-09-22T12:00:00.000Z'),
  index: 0,
  memoryUsedBytes: 20 * GIB,
  utilisationPercent: 40,
  temperatureC: 60,
  powerDrawWatts: 300,
  processAttribution: GpuProcessAttribution.EXACT,
  processes: [
    {
      pid: 2,
      usedBytes: 2 * GIB,
      name: '/usr/bin/python3.11',
      containerId: null,
      containerName: null,
      instanceKey: null,
      deploymentName: null,
    },
  ],
  predictions: [],
};

describe('MfGpuDeviceRow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("shows the device's figures under its bar and what is holding its memory", () => {
    const row = mount(DeviceRow, { props: { device } });

    expect(row.text()).toContain('20 GiB of 32 GiB');
    expect(row.text()).toContain('python3.112 GiB');
    expect(row.text()).toContain('12 GiB free');
  });

  it('names the device by its index and model, over its live figures', () => {
    const row = mount(DeviceRow, { props: { device } });

    expect(row.text()).toContain('GPU 0 · NVIDIA GeForce RTX 5090');
    expect(row.text()).toContain('40% util · 60 °C · 300 W · 00000000:01:00.0');
    expect(row.text()).not.toContain('Unattributed');
  });

  it('flags a device whose memory is not all attributed to a process', () => {
    const row = mount(DeviceRow, {
      props: { device: { ...device, processAttribution: GpuProcessAttribution.UNAVAILABLE, processes: [] } },
    });

    expect(row.text()).toContain('Unattributed');
  });

  it("carries the ledger's figures for the device into its bar", () => {
    const row = mount(DeviceRow, {
      props: {
        device: {
          ...device,
          predictions: [
            { instanceKey: '01928f3c-0000-7000-8000-000000000001', deploymentName: 'qwen-coder', bytes: 4 * GIB },
          ],
        },
        headroomBytes: GIB,
      },
    });

    expect(row.text()).toContain('qwen-coder (starting)4 GiB');
    expect(row.text()).toContain('7 GiB free');
  });
});
