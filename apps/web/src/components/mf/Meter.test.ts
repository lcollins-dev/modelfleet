import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Meter, { IMeterBand } from './Meter.vue';
import { METER_TONE_CLASSES } from './meterTone';

const band = (label: string, percent: number): IMeterBand => ({ label, tone: 'primary', percent, value: `${percent}` });

const mountMeter = (props: Record<string, unknown>) => mount(Meter, { props: { bands: [], ...props } });

const widths = (wrapper: ReturnType<typeof mountMeter>): string[] =>
  wrapper.findAll('[title]:not([data-overflow])').map(segment => segment.attributes('style') ?? '');

describe('MfMeter', () => {
  it('sizes each band by its share of the whole bar, in its tone', () => {
    const meter = mountMeter({ bands: [{ label: 'Headroom', tone: 'strong', percent: 2.5 }, band('Used', 40)] });

    expect(widths(meter)).toEqual(['width: 2.5%;', 'width: 40%;']);
    expect(meter.findAll('[title]')[0].classes()).toContain('bg-line-strong');
    expect(meter.findAll('[title]')[1].attributes('title')).toBe('Used · 40');
  });

  it('paints each legend dot in the same tone as its band', () => {
    const meter = mountMeter({
      bands: [
        { label: 'Xorg', tone: 'series-2', percent: 10 },
        { label: 'kwin', tone: 'series-5', percent: 5 },
      ],
      legend: true,
    });

    const dots = meter.findAll('[data-testid="meter-legend"] .size-2');

    expect(meter.findAll('[title]').map(segment => segment.classes().join(' '))).toEqual([
      METER_TONE_CLASSES['series-2'],
      METER_TONE_CLASSES['series-5'],
    ]);
    expect(dots[0].classes()).toContain(METER_TONE_CLASSES['series-2']);
    expect(dots[1].classes()).toContain(METER_TONE_CLASSES['series-5']);
  });

  it('right-aligns a lone label, and spreads a label and detail across the bar', () => {
    const lone = mountMeter({ label: '214.6 / 320.0 GiB' });
    const pair = mountMeter({ label: '41.8 of 80 GiB', detail: '38.2 GiB free' });

    expect(lone.get('.font-mono').classes()).toContain('justify-end');
    expect(pair.get('.font-mono').classes()).toContain('justify-between');
    expect(pair.text()).toContain('38.2 GiB free');
  });

  it('lists each band with its figure in the legend only when asked', () => {
    const bare = mountMeter({ bands: [band('qwen-coder', 30)] });
    const legend = mountMeter({ bands: [band('qwen-coder', 30)], legend: true });

    expect(bare.find('[data-testid="meter-legend"]').exists()).toBe(false);
    expect(legend.get('[data-testid="meter-legend"]').text()).toBe('qwen-coder30');
  });

  it('narrows bands running past the bar to fit, marking the end and what lies past it', () => {
    const meter = mountMeter({ bands: [band('Used', 90), band('Starting', 30)], legend: true, overflowValue: '6 GiB' });

    expect(widths(meter)[0]).toContain('width: 75%');
    expect(widths(meter)[1]).toContain('width: 25%');
    expect(meter.get('[data-overflow]').attributes('style')).toContain(`left: ${(100 / 120) * 100}%`);
    expect(meter.text()).toContain('Over6 GiB');
  });

  it('marks nothing where no overrun is given, however the bands sum', () => {
    const meter = mountMeter({ bands: [band('Used', 90), band('Starting', 30)], legend: true });

    expect(widths(meter)[0]).toContain('width: 90%');
    expect(meter.find('[data-overflow]').exists()).toBe(false);
    expect(meter.text()).not.toContain('Over');
  });
});
