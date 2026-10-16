import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import IconMemory from '~icons/material-symbols/memory-outline-rounded';

import KpiTile from './KpiTile.vue';

describe('MfKpiTile', () => {
  it('shows its label, value and unit', () => {
    const tile = mount(KpiTile, {
      props: { label: 'VRAM committed', icon: IconMemory, value: '373.8', unit: 'of 600 GiB' },
    });

    expect(tile.text()).toContain('VRAM committed');
    expect(tile.text()).toContain('373.8');
    expect(tile.text()).toContain('of 600 GiB');
    expect(tile.find('svg').exists()).toBe(true);
  });

  it('shares the band bar out by each band against the others, leaving out empty ones', () => {
    const tile = mount(KpiTile, {
      props: {
        label: 'Nodes',
        value: 5,
        bands: [
          { tone: 'success', percent: 2 },
          { tone: 'error', percent: 0 },
          { tone: 'strong', percent: 3 },
        ],
      },
    });

    const bands = tile.get('[data-testid="kpi-bands"]').findAll('div');

    expect(bands.map(segment => segment.attributes('style'))).toEqual(['flex-grow: 2;', 'flex-grow: 3;']);
    expect(bands[0].classes()).toContain('bg-success');
  });

  it('leaves a band without a tone empty, so the leftover share shows the track', () => {
    const tile = mount(KpiTile, {
      props: {
        label: 'VRAM in use',
        value: '62 GiB',
        bands: [{ tone: 'primary', percent: 62 }, { percent: 38 }],
        legend: [{ label: '62% in use', tone: 'primary' }, { label: '38 GiB free' }],
      },
    });

    const bar = tile.get('[data-testid="kpi-bands"]');
    const bands = bar.findAll('div');

    expect(bar.classes()).toEqual(expect.arrayContaining(['overflow-hidden', 'bg-emphasis']));
    expect(bands[1].classes()).toEqual(['basis-0', 'rounded-xs']);
    expect(tile.findAll('.rounded-full')[1].classes()).toContain('bg-transparent');
  });

  it('draws no bar without bands, and keeps an empty dot for a legend item without a tone', () => {
    const tile = mount(KpiTile, {
      props: {
        label: 'Deployments',
        value: 7,
        legend: [{ label: '4 ready', tone: 'success' }, { label: 'Problems first' }],
      },
    });

    expect(tile.find('[data-testid="kpi-bands"]').exists()).toBe(false);
    expect(tile.text()).toContain('4 ready');
    expect(tile.text()).toContain('Problems first');
    expect(tile.findAll('.rounded-full').map(dot => dot.classes())).toEqual([
      expect.arrayContaining(['bg-success']),
      expect.arrayContaining(['bg-transparent']),
    ]);
  });

  it('draws no dots when no legend item carries a tone', () => {
    const tile = mount(KpiTile, {
      props: { label: 'CPU', value: 64, unit: 'cores', legend: [{ label: 'AMD EPYC 7763' }] },
    });

    expect(tile.findAll('.rounded-full')).toHaveLength(0);
  });

  it('drops the value lower when there is no bar, to centre it in the tile', () => {
    const withBar = mount(KpiTile, { props: { label: 'Nodes', value: 5, bands: [{ tone: 'success', percent: 1 }] } });
    const withoutBar = mount(KpiTile, { props: { label: 'Load', value: '4.12' } });

    expect(withBar.get('[data-testid="kpi-value"]').classes()).toContain('mt-1.5');
    expect(withoutBar.get('[data-testid="kpi-value"]').classes()).toContain('mt-3.5');
  });

  it('turns its icon warning and leads its legend with Stale once its figure goes stale', () => {
    const tile = mount(KpiTile, {
      props: {
        label: 'Nodes',
        icon: IconMemory,
        value: 5,
        legend: [{ label: '5 online', tone: 'success' }],
        stale: true,
      },
    });

    const legend = tile.findAll('.whitespace-nowrap').map(item => item.text());

    expect(tile.get('svg').classes()).toContain('text-warning');
    expect(legend).toEqual(['Stale', '5 online']);
  });
});
