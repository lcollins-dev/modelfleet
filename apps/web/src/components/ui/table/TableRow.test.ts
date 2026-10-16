import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import TableRow from './TableRow.vue';

const mountExpandable = (props: Record<string, unknown> = {}) =>
  mount(TableRow, {
    props,
    slots: { default: '<span>node.registered</span>', expand: '<div data-testid="detail">nodeKey 7</div>' },
  });

describe('UiTableRow', () => {
  it('opens and closes its panel when the row is clicked', async () => {
    const wrapper = mountExpandable();

    expect(wrapper.find('[data-testid="detail"]').exists()).toBe(false);

    await wrapper.get('span').trigger('click');

    expect(wrapper.get('[data-testid="detail"]').text()).toBe('nodeKey 7');

    await wrapper.get('span').trigger('click');

    expect(wrapper.find('[data-testid="detail"]').exists()).toBe(false);
  });

  it('ends with a chevron button that reports and toggles the panel once per press', async () => {
    const wrapper = mountExpandable();
    const chevron = wrapper.get('button');

    expect(chevron.attributes('aria-expanded')).toBe('false');
    expect(chevron.attributes('aria-label')).toBe('Show details');

    await chevron.trigger('click');

    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('button').attributes('aria-label')).toBe('Hide details');
    expect(wrapper.emitted('update:expanded')).toEqual([[true]]);
  });

  it('follows the expanded state it is bound to', () => {
    const wrapper = mountExpandable({ expanded: true });

    expect(wrapper.find('[data-testid="detail"]').exists()).toBe(true);
  });

  it('stays a plain row with no chevron when it has nothing to expand', async () => {
    const wrapper = mount(TableRow, { slots: { default: '<span>node.registered</span>' } });

    await wrapper.get('span').trigger('click');

    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.emitted('update:expanded')).toBeUndefined();
  });

  it('links the whole row from a link of its own, named by the row, so the row can hold other controls', () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
    });
    const wrapper = mount(TableRow, {
      props: { to: '/nodes/2' },
      slots: { default: '<span>gpu-box</span><a href="/elsewhere">Output</a>' },
      global: { plugins: [router] },
    });

    const link = wrapper.get('[data-testid="table-row-link"]');

    expect(wrapper.html()).toMatch(/^<div/);
    expect(link.attributes('href')).toBe('/nodes/2');
    expect(link.attributes('aria-labelledby')).toBe(wrapper.attributes('id'));
    expect(link.text()).toBe('');
  });
});
