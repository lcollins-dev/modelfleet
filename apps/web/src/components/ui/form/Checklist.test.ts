import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import Checklist, { IChecklistItem } from './Checklist.vue';

const ITEMS: IChecklistItem[] = [
  { value: 'node-a-01', label: 'node-a-01', meta: '1.42 TiB free' },
  { value: 'node-w-03', label: 'node-w-03', meta: 'Offline', disabled: true },
  { value: 'node-b-02', label: 'node-b-02' },
];

describe('Checklist', () => {
  it('checks the items selected, with each meta on the right', () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: ITEMS, selected: ['node-a-01'] } });
    const rows = list.findAll('[data-testid="picker-row"]');
    const inputs = rows.map(row => row.get('input').element);

    expect(inputs.map(input => input.checked)).toEqual([true, false, false]);
    expect(rows[0].text()).toContain('1.42 TiB free');
    expect(inputs[1].disabled).toBe(true);
  });

  it('adds an item to the selection when checked and drops it when unchecked', async () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: ITEMS, selected: ['node-a-01'] } });
    const inputs = list.findAll('[data-testid="picker-row"] input');

    await inputs[2].setValue(true);
    await inputs[0].setValue(false);

    expect(list.emitted('update:selected')).toEqual([[['node-a-01', 'node-b-02']], [['node-b-02']]]);
  });

  it('selects every item it can from Select all, skipping the disabled, and clears them all again', async () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: ITEMS, selectAll: true } });
    const selectAll = list.get('label input');

    await selectAll.setValue(true);
    await selectAll.setValue(false);

    expect(list.emitted('update:selected')).toEqual([[['node-a-01', 'node-b-02']], [[]]]);
  });

  it('keeps a disabled item ticked or unticked through Select all', async () => {
    const list = mount(Checklist, {
      props: { label: 'Nodes', items: ITEMS, selectAll: true, selected: ['node-w-03'] },
    });
    const selectAll = list.get('label input');

    await selectAll.setValue(true);
    await list.setProps({ selected: ['node-w-03', 'node-a-01', 'node-b-02'] });
    await selectAll.setValue(false);

    expect(list.emitted('update:selected')).toEqual([[['node-w-03', 'node-a-01', 'node-b-02']], [['node-w-03']]]);
  });

  it('disables Select all where every item is disabled', () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: [ITEMS[1]], selectAll: true } });

    expect(list.get('label input').attributes('disabled')).toBeDefined();
  });

  it('marks Select all partly ticked while only some items are', () => {
    const some = mount(Checklist, {
      props: { label: 'Nodes', items: ITEMS, selectAll: true, selected: ['node-a-01'] },
    });
    const all = mount(Checklist, {
      props: { label: 'Nodes', items: ITEMS, selectAll: true, selected: ['node-a-01', 'node-b-02'] },
    });

    expect(some.get('label input').attributes('aria-checked')).toBe('mixed');
    expect((all.get('label input').element as HTMLInputElement).checked).toBe(true);
    expect(all.get('label input').attributes('aria-checked')).toBeUndefined();
  });

  it('draws no head without Select all or a summary', () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: ITEMS } });

    expect(list.find('[data-testid="picker-summary"]').exists()).toBe(false);
    expect(list.findAll('input')).toHaveLength(ITEMS.length);
  });

  it('sets the labels in mono when asked, for names and paths', () => {
    const list = mount(Checklist, { props: { label: 'Nodes', items: ITEMS, mono: true } });

    expect(list.get('[data-testid="picker-row"] .font-mono').text()).toBe('node-a-01');
  });
});
