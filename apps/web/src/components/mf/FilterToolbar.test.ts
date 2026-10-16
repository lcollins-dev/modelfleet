import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import FilterToolbar from './FilterToolbar.vue';

const SEGMENTS = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
];

describe('MfFilterToolbar', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reports what is typed into its search', async () => {
    const toolbar = mount(FilterToolbar, { props: { placeholder: 'Search name or host', search: '' } });

    await toolbar.get('input').setValue('gpu-01');

    expect(toolbar.get('input').attributes('placeholder')).toBe('Search name or host');
    expect(toolbar.emitted('update:search')).toEqual([['gpu-01']]);
  });

  it('narrows by a segment when given segments', async () => {
    const toolbar = mount(FilterToolbar, { props: { placeholder: 'Search', segments: SEGMENTS, filter: 'all' } });

    await toolbar.get('[role="radio"][aria-checked="false"]').trigger('click');

    expect(toolbar.emitted('update:filter')).toEqual([['online']]);
    expect(toolbar.findComponent({ name: 'Select' }).exists()).toBe(false);
  });

  it('narrows by a select when given options', async () => {
    const toolbar = mount(FilterToolbar, {
      props: { placeholder: 'Search events', options: SEGMENTS, filter: 'all', filterLabel: 'Event kind' },
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    });

    await toolbar.get('[role="combobox"]').trigger('click');
    await toolbar.findAll('[role="option"]')[1].trigger('click');

    expect(toolbar.get('[role="combobox"]').attributes('aria-label')).toBe('Event kind');
    expect(toolbar.find('[role="radiogroup"]').exists()).toBe(false);
    expect(toolbar.emitted('update:filter')).toEqual([['online']]);

    toolbar.unmount();
  });

  it('leaves out the search without a placeholder, keeping its slotted controls', () => {
    const toolbar = mount(FilterToolbar, {
      slots: { start: '<span data-testid="start">Type</span>', default: '<button>More filters</button>' },
    });

    expect(toolbar.find('input').exists()).toBe(false);
    expect(toolbar.get('[data-testid="start"]').text()).toBe('Type');
    expect(toolbar.get('button').text()).toBe('More filters');
  });
});
