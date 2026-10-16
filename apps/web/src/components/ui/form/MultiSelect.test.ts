import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import MultiSelect from './MultiSelect.vue';
import { SelectOptions } from './selectOptions';

const OPTIONS: SelectOptions<string> = [
  { value: 'user-admin', label: 'User admin', description: 'Manages people' },
  { value: 'system-admin', label: 'System admin', disabled: true },
  { value: 'viewer', label: 'Viewer' },
];

const mountMultiSelect = (props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) =>
  mount(MultiSelect<string>, {
    props: { options: OPTIONS, value: [], ...props },
    attrs,
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });

type MultiSelectWrapper = ReturnType<typeof mountMultiSelect>;

const combobox = (wrapper: MultiSelectWrapper) => wrapper.get('input[role="combobox"]');

const activeLabel = (wrapper: MultiSelectWrapper) => {
  const activeId = combobox(wrapper).attributes('aria-activedescendant');

  return activeId === undefined ? undefined : wrapper.get(`[id="${activeId}"]`).text();
};

const press = (wrapper: MultiSelectWrapper, key: string) => combobox(wrapper).trigger('keydown', { key });

const chips = (wrapper: MultiSelectWrapper) =>
  wrapper.findAll('[data-testid="multi-select-chip"]').map(chip => chip.text());

enableAutoUnmount(afterEach);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MultiSelect', () => {
  it('shows each picked value as a chip and the placeholder only when none is picked', async () => {
    const wrapper = mountMultiSelect({ placeholder: 'Pick roles' });

    expect(combobox(wrapper).attributes('placeholder')).toBe('Pick roles');

    await wrapper.setProps({ value: ['viewer', 'user-admin'] });

    expect(chips(wrapper)).toEqual(['Viewer', 'User admin']);
    expect(combobox(wrapper).attributes('placeholder')).toBeUndefined();
  });

  it('opens a multi-select listbox marking every picked option', async () => {
    const wrapper = mountMultiSelect({ value: ['viewer'] });

    await press(wrapper, 'ArrowDown');

    const listbox = wrapper.get('[role="listbox"]');

    expect(combobox(wrapper).attributes('aria-expanded')).toBe('true');
    expect(combobox(wrapper).attributes('aria-controls')).toBe(listbox.attributes('id'));
    expect(listbox.attributes('aria-multiselectable')).toBe('true');
    expect(wrapper.findAll('[role="option"]').map(option => option.attributes('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('toggles the active option with Enter and stays open', async () => {
    const wrapper = mountMultiSelect({ value: ['viewer'] });

    await press(wrapper, 'ArrowDown');
    expect(activeLabel(wrapper)).toContain('User admin');

    await press(wrapper, 'Enter');
    expect(wrapper.emitted('update:value')).toEqual([[['viewer', 'user-admin']]]);

    await wrapper.setProps({ value: ['viewer', 'user-admin'] });
    await press(wrapper, 'ArrowDown');
    expect(activeLabel(wrapper)).toBe('Viewer');

    await press(wrapper, 'Enter');
    expect(wrapper.emitted('update:value')?.[1]).toEqual([['user-admin']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true);
  });

  it('steps past disabled options and wraps round', async () => {
    const wrapper = mountMultiSelect();

    await press(wrapper, 'ArrowDown');
    await press(wrapper, 'ArrowUp');

    expect(activeLabel(wrapper)).toBe('Viewer');

    await press(wrapper, 'ArrowDown');

    expect(activeLabel(wrapper)).toContain('User admin');
  });

  it('filters the options by label and description as it is typed into', async () => {
    const wrapper = mountMultiSelect();

    await combobox(wrapper).setValue('people');

    const options = wrapper.findAll('[role="option"]');

    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain('User admin');
    expect(activeLabel(wrapper)).toContain('User admin');

    await combobox(wrapper).setValue('nobody');

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0);
    expect(wrapper.get('[role="listbox"]').text()).toBe('No matches');
  });

  it('clears the search once an option is toggled', async () => {
    const wrapper = mountMultiSelect();

    await combobox(wrapper).setValue('view');
    await press(wrapper, 'Enter');

    expect(wrapper.emitted('update:value')).toEqual([[['viewer']]]);
    expect((combobox(wrapper).element as HTMLInputElement).value).toBe('');
  });

  it('removes the last pick with Backspace while the search is empty', async () => {
    const wrapper = mountMultiSelect({ value: ['viewer', 'user-admin'] });

    await press(wrapper, 'Backspace');

    expect(wrapper.emitted('update:value')).toEqual([[['viewer']]]);
  });

  it('removes a pick from its chip', async () => {
    const wrapper = mountMultiSelect({ value: ['viewer', 'user-admin'] });

    await wrapper.get('button[aria-label="Remove Viewer"]').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([[['user-admin']]]);
  });

  it('closes and clears the search on Escape', async () => {
    const wrapper = mountMultiSelect();

    await combobox(wrapper).setValue('view');
    await press(wrapper, 'Escape');

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect((combobox(wrapper).element as HTMLInputElement).value).toBe('');
  });

  it('toggles with Space only when it is not searchable', async () => {
    const wrapper = mountMultiSelect({ searchable: false });

    expect(combobox(wrapper).attributes('readonly')).toBeDefined();

    await press(wrapper, ' ');
    await press(wrapper, ' ');

    expect(wrapper.emitted('update:value')).toEqual([[['user-admin']]]);
  });

  it('toggles an option on click and ignores a disabled one', async () => {
    const wrapper = mountMultiSelect();

    await press(wrapper, 'ArrowDown');
    await wrapper.findAll('[role="option"]')[1].trigger('click');

    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.findAll('[role="option"]')[2].trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([[['viewer']]]);
  });

  it('offers no chip removal while disabled', () => {
    const wrapper = mountMultiSelect({ value: ['viewer'], disabled: true });

    expect(wrapper.find('button[aria-label="Remove Viewer"]').exists()).toBe(false);
    expect(combobox(wrapper).attributes('disabled')).toBeDefined();
  });

  it('posts each value through its own hidden input when named', () => {
    const wrapper = mountMultiSelect({ value: ['viewer', 'user-admin'], name: 'roles' });

    expect(wrapper.findAll('input[type="hidden"]').map(input => input.attributes('value'))).toEqual([
      'viewer',
      'user-admin',
    ]);
  });

  it('puts its attributes on the combobox and its class on the wrapper', () => {
    const wrapper = mountMultiSelect({}, { id: 'roles-input', class: 'max-w-xs' });

    expect(combobox(wrapper).attributes('id')).toBe('roles-input');
    expect(wrapper.classes()).toContain('max-w-xs');
  });

  it('stays open when an option in its teleported listbox is clicked', async () => {
    const wrapper = mount(MultiSelect<string>, { props: { options: OPTIONS, value: [] }, attachTo: document.body });

    await combobox(wrapper).trigger('keydown', { key: 'ArrowDown' });
    await new Promise(resolve => setTimeout(resolve, 0));

    const option = document.querySelectorAll('[role="option"]')[2];
    option.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    option.dispatchEvent(new Event('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('update:value')).toEqual([[['viewer']]]);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
  });
});
