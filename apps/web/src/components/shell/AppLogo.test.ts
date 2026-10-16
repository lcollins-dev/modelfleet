import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppLogo from './AppLogo.vue';

describe('AppLogo', () => {
  it('shows the wordmark beside the logo', () => {
    const wrapper = mount(AppLogo);

    expect(wrapper.text()).toBe('Modelfleet');
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('draws the logo larger at the large size', () => {
    expect(mount(AppLogo).get('img').attributes('width')).toBe('26');
    expect(
      mount(AppLogo, { props: { size: 'lg' } })
        .get('img')
        .attributes('width')
    ).toBe('36');
  });
});
