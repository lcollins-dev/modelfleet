import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CountBadge from './CountBadge.vue';

describe('CountBadge', () => {
  it('shows the count', () => {
    expect(mount(CountBadge, { props: { count: 7 } }).text()).toBe('7');
  });

  it('caps the count at its max', () => {
    expect(mount(CountBadge, { props: { count: 100 } }).text()).toBe('99+');
    expect(mount(CountBadge, { props: { count: 12, max: 9 } }).text()).toBe('9+');
  });

  it('renders nothing for a count of zero', () => {
    expect(
      mount(CountBadge, { props: { count: 0 } })
        .find('span')
        .exists()
    ).toBe(false);
  });
});
