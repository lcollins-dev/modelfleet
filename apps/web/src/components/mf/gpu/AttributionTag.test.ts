import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { GpuTelemetryDto } from '@libs/dto';
import { GpuProcessAttribution, GpuVendor } from '@libs/dto';

import AttributionTag from './AttributionTag.vue';

const device = (processAttribution: GpuProcessAttribution | null): GpuTelemetryDto => ({
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA A100-SXM4-80GB',
  pciBusId: null,
  memoryTotalBytes: null,
  lastReportedDate: new Date('2026-09-22T12:00:00.000Z'),
  index: 0,
  memoryUsedBytes: null,
  utilisationPercent: null,
  temperatureC: null,
  powerDrawWatts: null,
  processAttribution,
  processes: [],
  predictions: [],
});

describe('MfGpuAttributionTag', () => {
  it('shows nothing while every device attributes its memory', () => {
    const tag = mount(AttributionTag, { props: { devices: [device(GpuProcessAttribution.EXACT)] } });

    expect(tag.find('[data-testid="attribution-tag"]').exists()).toBe(false);
  });

  it('names the worst gap across the devices and explains it on hover', () => {
    const tag = mount(AttributionTag, {
      props: { devices: [device(GpuProcessAttribution.APPROXIMATE), device(GpuProcessAttribution.UNAVAILABLE)] },
    });

    const wrapper = tag.get('[data-testid="attribution-tag"]');

    expect(wrapper.text()).toBe('Per-process memory unavailable');
    expect(wrapper.attributes('title')).toContain('pid: host');
  });
});
