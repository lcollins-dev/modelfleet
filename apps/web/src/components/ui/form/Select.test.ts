import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import Select from './Select.vue';
import { SelectOptions } from './selectOptions';

const OPTIONS: SelectOptions<string> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first', disabled: true },
  { value: 'name', label: 'Name', description: 'A to Z' },
];

const mountSelect = (props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) =>
  mount(Select<string>, {
    props: { options: OPTIONS, value: null, ...props },
    attrs,
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });

type SelectWrapper = ReturnType<typeof mountSelect>;

const trigger = (wrapper: SelectWrapper) => wrapper.get('[role="combobox"]');

const activeLabel = (wrapper: SelectWrapper) => {
  const activeId = trigger(wrapper).attributes('aria-activedescendant');

  return activeId === undefined ? undefined : wrapper.get(`[id="${activeId}"]`).text();
};

const press = (wrapper: SelectWrapper, key: string) => trigger(wrapper).trigger('keydown', { key });

enableAutoUnmount(afterEach);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Select', () => {
  it('is a collapsed combobox showing its placeholder until a value is picked', async () => {
    const wrapper = mountSelect({ placeholder: 'Sort by' });

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('false');
    expect(trigger(wrapper).attributes('aria-haspopup')).toBe('listbox');
    expect(trigger(wrapper).text()).toBe('Sort by');

    await wrapper.setProps({ value: 'name' });

    expect(trigger(wrapper).text()).toBe('Name');
  });

  it('opens a listbox of its options on click, marking the picked one', async () => {
    const wrapper = mountSelect({ value: 'name' });

    await trigger(wrapper).trigger('click');

    const listbox = wrapper.get('[role="listbox"]');
    const options = wrapper.findAll('[role="option"]');

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(trigger(wrapper).attributes('aria-controls')).toBe(listbox.attributes('id'));
    expect(options.map(option => option.attributes('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(options[1].attributes('aria-disabled')).toBe('true');
    expect(activeLabel(wrapper)).toContain('Name');
  });

  it('opens from the keyboard on the first enabled option and steps past disabled ones', async () => {
    const wrapper = mountSelect();

    await press(wrapper, 'ArrowDown');

    expect(trigger(wrapper).attributes('aria-expanded')).toBe('true');
    expect(activeLabel(wrapper)).toBe('Newest first');

    await press(wrapper, 'ArrowDown');

    expect(activeLabel(wrapper)).toContain('Name');

    await press(wrapper, 'ArrowDown');

    expect(activeLabel(wrapper)).toBe('Newest first');

    await press(wrapper, 'ArrowUp');

    expect(activeLabel(wrapper)).toContain('Name');
  });

  it('jumps to the first and last enabled options with Home and End', async () => {
    const wrapper = mountSelect();

    await press(wrapper, 'Enter');
    await press(wrapper, 'End');

    expect(activeLabel(wrapper)).toContain('Name');

    await press(wrapper, 'Home');

    expect(activeLabel(wrapper)).toBe('Newest first');
  });

  it.each(['Enter', ' '])('picks the active option with %j and closes', async key => {
    const wrapper = mountSelect();

    await press(wrapper, key);
    await press(wrapper, 'ArrowDown');
    await press(wrapper, key);

    expect(wrapper.emitted('update:value')).toEqual([['name']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it('closes on Escape and Tab without picking', async () => {
    const wrapper = mountSelect();

    await press(wrapper, 'ArrowDown');
    await press(wrapper, 'Escape');

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);

    await press(wrapper, 'ArrowDown');
    await press(wrapper, 'Tab');

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('picks an option on click and ignores a disabled one', async () => {
    const wrapper = mountSelect();

    await trigger(wrapper).trigger('click');
    await wrapper.findAll('[role="option"]')[1].trigger('click');

    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.findAll('[role="option"]')[2].trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([['name']]);
  });

  it('closes on a click outside', async () => {
    const wrapper = mountSelect();

    await trigger(wrapper).trigger('click');
    // onClickOutside skips a click that lands in the same task as the one before it.
    await new Promise(resolve => setTimeout(resolve, 0));
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new Event('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it('lists grouped options under a labelled group', async () => {
    const wrapper = mountSelect({
      options: ['Any', { label: 'Roles', options: ['Admin', { value: 'user', label: 'User' }] }],
    });

    await trigger(wrapper).trigger('click');

    const group = wrapper.get('[role="group"]');

    expect(wrapper.get(`[id="${group.attributes('aria-labelledby')}"]`).text()).toBe('Roles');
    expect(group.findAll('[role="option"]').map(option => option.text())).toEqual(['Admin', 'User']);
  });

  it('posts its value through a hidden input when named', () => {
    const wrapper = mountSelect({ value: 'name', name: 'sort' });

    expect(wrapper.get('input[type="hidden"]').attributes()).toMatchObject({ name: 'sort', value: 'name' });
  });

  it('puts its attributes on the combobox and its class on the wrapper', () => {
    const wrapper = mountSelect({}, { id: 'sort-input', 'aria-invalid': true, class: 'max-w-xs' });

    expect(trigger(wrapper).attributes('id')).toBe('sort-input');
    expect(trigger(wrapper).attributes('aria-invalid')).toBe('true');
    expect(trigger(wrapper).classes()).not.toContain('max-w-xs');
    expect(wrapper.classes()).toContain('max-w-xs');
  });

  it('clears back to null when clearable', async () => {
    const wrapper = mountSelect({ value: 'name', clearable: true });

    await wrapper.get('button[aria-label="Clear"]').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([[null]]);
  });

  it('offers no clear button while empty or not clearable', async () => {
    const wrapper = mountSelect({ clearable: true });

    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);

    await wrapper.setProps({ value: 'name', clearable: false });

    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it('narrows its options by label and description as text is typed when searchable', async () => {
    const wrapper = mountSelect({ searchable: true, value: 'newest' });

    expect((trigger(wrapper).element as HTMLInputElement).value).toBe('Newest first');

    await trigger(wrapper).setValue('a to');

    expect(wrapper.findAll('[role="option"]').map(option => option.text())).toEqual(['NameA to Z']);
    expect(activeLabel(wrapper)).toContain('Name');

    await press(wrapper, 'Enter');

    expect(wrapper.emitted('update:value')).toEqual([['name']]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });

  it('keeps Space for the typed text when searchable', async () => {
    const wrapper = mountSelect({ searchable: true });

    await trigger(wrapper).setValue('first');
    await press(wrapper, ' ');

    expect(wrapper.emitted('update:value')).toBeUndefined();
  });

  it('leaves narrowing to the parent when remote, emitting each search and a reset on close', async () => {
    const wrapper = mountSelect({ searchable: true, remote: true });

    await trigger(wrapper).setValue('zzz');

    expect(wrapper.findAll('[role="option"]')).toHaveLength(3);
    expect(wrapper.emitted('search')).toEqual([['zzz']]);

    await press(wrapper, 'Escape');

    expect(wrapper.emitted('search')).toEqual([['zzz'], ['']]);
  });

  it('shows a spinner while loading and says so in an empty list', async () => {
    const wrapper = mountSelect({ options: [], loading: true });

    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(trigger(wrapper).attributes('aria-busy')).toBe('true');

    await trigger(wrapper).trigger('click');

    expect(wrapper.get('[role="listbox"]').text()).toBe('Loading...');
  });

  it('renders the optionExtra slot beside each option', async () => {
    const wrapper = mount(Select<string>, {
      props: { options: OPTIONS, value: null },
      slots: { optionExtra: '<span class="extra">{{ params.option.value }}</span>' },
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    });

    await wrapper.get('[role="combobox"]').trigger('click');

    expect(wrapper.findAll('.extra').map(extra => extra.text())).toEqual(['newest', 'oldest', 'name']);
  });

  describe('with its listbox teleported', () => {
    const visibilityCallbacks: IntersectionObserverCallback[] = [];

    beforeEach(() => {
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: IntersectionObserverCallback) {
            visibilityCallbacks.push(callback);
          }

          observe() {}

          disconnect() {}
        }
      );
    });

    afterEach(() => {
      visibilityCallbacks.splice(0);
      vi.unstubAllGlobals();
    });

    const mountTeleported = (attachTo: Element = document.body, options: SelectOptions<string> = OPTIONS) =>
      mount(Select<string>, { props: { options, value: null }, attachTo });

    const listbox = () => document.querySelector('[role="listbox"]');

    it('renders its listbox at the body, outside every container around the control', async () => {
      const wrapper = mountTeleported();

      await trigger(wrapper).trigger('click');

      expect(listbox()?.parentElement).toBe(document.body);
      expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    });

    it('renders its listbox into the dialog it sits in', async () => {
      const dialog = document.createElement('dialog');
      document.body.append(dialog);
      const wrapper = mountTeleported(dialog);

      await trigger(wrapper).trigger('click');

      expect(listbox()?.parentElement).toBe(dialog);
    });

    it('steps its active option from the keyboard, naming it by an id the document resolves', async () => {
      const wrapper = mountTeleported();

      await press(wrapper, 'ArrowDown');
      await press(wrapper, 'ArrowDown');

      const activeId = trigger(wrapper).attributes('aria-activedescendant') ?? '';

      expect(document.getElementById(activeId)?.textContent).toContain('Name');
    });

    it('stays open when its listbox is clicked away from an option', async () => {
      const wrapper = mountTeleported(document.body, [{ label: 'Roles', options: ['Admin', 'User'] }]);

      await trigger(wrapper).trigger('click');
      await new Promise(resolve => setTimeout(resolve, 0));

      const heading = document.querySelector('[role="group"] > div');
      heading?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      heading?.dispatchEvent(new Event('click', { bubbles: true }));
      await nextTick();

      expect(listbox()).not.toBeNull();
    });

    it('closes once its control is scrolled out of view', async () => {
      const wrapper = mountTeleported();

      await trigger(wrapper).trigger('click');
      visibilityCallbacks.forEach(callback => {
        callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      await nextTick();

      expect(listbox()).toBeNull();
      expect(trigger(wrapper).attributes('aria-expanded')).toBe('false');
    });
  });
});
