import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import Menu, { IMenuItem } from './Menu.vue';

const ITEMS: IMenuItem[] = [
  { key: 'profile', label: 'Edit profile' },
  { key: 'admin', label: 'Admin' },
  { key: 'logout', label: 'Log out', danger: true },
];

const mountMenu = (props: Record<string, unknown> = {}) =>
  mount(Menu, { props: { items: ITEMS, ...props }, attachTo: document.body });

const focusedText = () => document.activeElement?.textContent.trim();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Menu', () => {
  it('is a menu of items named by its title', () => {
    const wrapper = mountMenu({ title: 'Ann Lee', subtitle: 'ann@example.com' });
    const menu = wrapper.get('[role="menu"]');

    expect(wrapper.get(`[id="${menu.attributes('aria-labelledby')}"]`).text()).toBe('Ann Lee');
    expect(wrapper.text()).toContain('ann@example.com');
    expect(menu.findAll('[role="menuitem"]').map(item => item.text())).toEqual(['Edit profile', 'Admin', 'Log out']);
  });

  it('falls back to its label for a name without a title', () => {
    const wrapper = mountMenu({ label: 'Account' });

    expect(wrapper.get('[role="menu"]').attributes('aria-label')).toBe('Account');
  });

  it('focuses its first item when it opens', () => {
    mountMenu();

    expect(focusedText()).toBe('Edit profile');
  });

  it('moves focus through its items with the arrow keys, Home and End, wrapping round', async () => {
    const wrapper = mountMenu();
    const menu = wrapper.get('[role="menu"]');

    await menu.trigger('keydown', { key: 'ArrowUp' });
    expect(focusedText()).toBe('Log out');

    await menu.trigger('keydown', { key: 'ArrowDown' });
    expect(focusedText()).toBe('Edit profile');

    await menu.trigger('keydown', { key: 'End' });
    expect(focusedText()).toBe('Log out');

    await menu.trigger('keydown', { key: 'Home' });
    expect(focusedText()).toBe('Edit profile');
  });

  it('emits the key of the item chosen', async () => {
    const wrapper = mountMenu();

    await wrapper.get('[data-testid="menu-item-logout"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([['logout']]);
  });
});
