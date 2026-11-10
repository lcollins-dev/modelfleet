import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';

import Table from './Table.vue';
import TableHead from './TableHead.vue';
import TableRow from './TableRow.vue';

describe('UiTable', () => {
  it('lays its rows out no narrower than 640px unless given a width', () => {
    const fixed = mount(Table, { props: { columns: '1fr 1fr' }, slots: { default: '<div data-testid="row" />' } });
    const narrow = mount(Table, { props: { columns: '1fr', minWidth: 0 }, slots: { default: '<div />' } });

    expect(fixed.get('[data-testid="row"]').element.parentElement?.getAttribute('style')).toContain('min-width: 640px');
    expect(narrow.get('.overflow-x-auto > div').attributes('style')).toContain('min-width: 0px');
  });

  it('stays one flow with the page unless given a scroll label', () => {
    const wrapper = mount(Table, { props: { columns: '1fr' }, slots: { default: '<div />' } });

    expect(wrapper.find('[role="region"]').exists()).toBe(false);
    expect(wrapper.get('.overflow-x-auto').classes()).not.toContain('max-h-96');
  });

  it('scrolls its rows in a named region the keyboard can reach, under a head that sticks', () => {
    const wrapper = mount(Table, {
      props: { columns: '1fr', scrollLabel: 'Files' },
      slots: { default: () => [h(TableHead, { sticky: true }, () => 'Path'), h(TableRow, () => 'model.gguf')] },
    });

    const region = wrapper.get('[role="region"]');

    expect(region.attributes('aria-label')).toBe('Files');
    expect(region.attributes('tabindex')).toBe('0');
    expect(region.classes()).toEqual(expect.arrayContaining(['max-h-96', 'scroll-pt-9', 'overflow-y-auto']));
    expect(region.get('[data-testid="table-head"]').classes()).toEqual(
      expect.arrayContaining(['sticky', 'top-0', 'bg-surface'])
    );
  });

  it('leaves a head in the flow unless told to stick', () => {
    const head = mount(TableHead, { slots: { default: 'Path' } });

    expect(head.classes()).not.toContain('sticky');
  });

  it('frames a toolbar above the rows and a footer below them', () => {
    const wrapper = mount(Table, {
      props: { columns: '1fr' },
      slots: {
        toolbar: '<input aria-label="Search" />',
        default: '<div>Row</div>',
        footer: '<span>Showing 1 of 1</span>',
      },
    });

    const html = wrapper.html();

    expect(wrapper.get('[data-testid="table-toolbar"] input').attributes('aria-label')).toBe('Search');
    expect(wrapper.get('[data-testid="table-footer"]').text()).toBe('Showing 1 of 1');
    expect(html.indexOf('table-toolbar')).toBeLessThan(html.indexOf('Row'));
    expect(html.indexOf('Row')).toBeLessThan(html.indexOf('table-footer'));
  });

  it('shows the empty state only when given one', () => {
    const empty = mount(Table, { props: { columns: '1fr' }, slots: { empty: 'No nodes match your search.' } });
    const filled = mount(Table, { props: { columns: '1fr' }, slots: { default: '<div>Row</div>' } });

    expect(empty.get('[data-testid="table-empty"]').text()).toBe('No nodes match your search.');
    expect(filled.find('[data-testid="table-empty"]').exists()).toBe(false);
    expect(filled.find('[data-testid="table-toolbar"]').exists()).toBe(false);
    expect(filled.find('[data-testid="table-footer"]').exists()).toBe(false);
  });

  it('lists its rows without a head, divided between them and padded as under one', () => {
    const row = (name: string) => h(TableRow, { 'data-testid': 'row' }, () => [h('span', name), h('span', 'Online')]);

    const wrapper = mount(Table, {
      props: { columns: '1fr auto' },
      slots: { default: () => [row('node-a-01'), row('node-b-02')] },
    });

    const rows = wrapper.findAll('[data-testid="row"]');
    const firstRow = rows[0].element;

    expect(rows).toHaveLength(2);
    expect(firstRow.parentElement?.firstElementChild).toBe(firstRow);
    expect(wrapper.find('.border-t').exists()).toBe(false);
    expect(rows[0].classes()).toEqual(expect.arrayContaining(['px-6', 'border-b', 'last:border-b-0']));
  });
});
