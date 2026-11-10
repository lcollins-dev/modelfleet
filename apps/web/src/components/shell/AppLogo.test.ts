import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppLogo from './AppLogo.vue';

describe('AppLogo', () => {
  it('shows the wordmark beside the logo', () => {
    const wrapper = mount(AppLogo);

    expect(wrapper.text()).toBe('Modelfleet');
    expect(wrapper.find('svg').exists()).toBe(true);
  });

  it('draws the logo larger at the large size', () => {
    expect(mount(AppLogo).get('svg').attributes('width')).toBe('26');
    expect(
      mount(AppLogo, { props: { size: 'lg' } })
        .get('svg')
        .attributes('width')
    ).toBe('36');
  });

  it('draws the hull and containers in the header token and only the top container in the primary token', () => {
    const shapes = mount(AppLogo).findAll('path, rect');

    const accented = shapes.filter(shape => shape.attributes('style')?.includes('var(--primary'));
    const inked = shapes.filter(shape => shape.attributes('style')?.includes('var(--fg-header'));

    expect(accented.map(shape => shape.attributes('y'))).toEqual(['4']);
    expect(inked).toHaveLength(shapes.length - 1);
  });
});
