import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ListRow from './ListRow.vue';

describe('UiListRow', () => {
  it('shows its title and meta', () => {
    const wrapper = mount(ListRow, { props: { title: 'node-a-01', meta: '/srv/models' } });

    expect(wrapper.text()).toContain('node-a-01');
    expect(wrapper.text()).toContain('/srv/models');
  });

  it('renders rich title and meta in place of the plain ones', () => {
    const wrapper = mount(ListRow, {
      slots: {
        title: '<span data-testid="title" class="font-mono">node-a-01</span>',
        meta: '<span data-testid="meta" class="font-mono">/srv/models</span>',
      },
    });

    expect(wrapper.get('[data-testid="title"]').text()).toBe('node-a-01');
    expect(wrapper.get('[data-testid="meta"]').text()).toBe('/srv/models');
  });

  it('leaves out the meta line when it has none', () => {
    const wrapper = mount(ListRow, { props: { title: 'node-a-01' } });

    expect(wrapper.find('.text-xs').exists()).toBe(false);
  });
});
