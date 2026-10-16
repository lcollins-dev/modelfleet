import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PickerRow from './PickerRow.vue';

describe('PickerRow', () => {
  it('ticks the box from a click on its label', async () => {
    const row = mount(PickerRow, { props: { label: 'rig-01', checked: false }, attachTo: document.body });

    await row.get('label span').trigger('click');

    expect(row.emitted('update:checked')).toEqual([[true]]);
  });

  it('opens and closes an expandable row from a click on its name, leaving the box unticked', async () => {
    const row = mount(PickerRow, {
      props: { label: 'rig-01', checked: false, expanded: false },
      attachTo: document.body,
    });
    const name = row.findAll('span').find(span => span.text() === 'rig-01');

    await name?.trigger('click');
    await row.setProps({ expanded: true });
    await row.get('[data-testid="picker-row"]').trigger('click');

    expect(row.emitted('update:expanded')).toEqual([[true], [false]]);
    expect(row.emitted('update:checked')).toBeUndefined();
  });

  it('keeps the name of an expandable row outside its checkbox label, so hovering it does not mark the box', () => {
    const row = mount(PickerRow, { props: { label: 'rig-01', checked: false, expanded: false } });

    expect(row.get('label').text()).toBe('');
    expect(row.get('input').attributes('aria-label')).toBe('rig-01');
  });

  it('ticks an expandable row from its box, and leaves it closed', async () => {
    const row = mount(PickerRow, {
      props: { label: 'rig-01', checked: false, expanded: false },
      attachTo: document.body,
    });

    await row.get('input').setValue(true);
    await row.get('input').trigger('click');

    expect(row.emitted('update:checked')?.[0]).toEqual([true]);
    expect(row.emitted('update:expanded')).toBeUndefined();
  });

  it('leaves a click on one of its buttons to the button', async () => {
    const row = mount(PickerRow, {
      props: { label: 'rig-01', checked: false, expanded: false },
      slots: { actions: '<button type="button">Show devices</button>' },
    });

    await row.get('button').trigger('click');

    expect(row.emitted('update:expanded')).toBeUndefined();
  });
});
