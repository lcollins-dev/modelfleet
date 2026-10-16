import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import UserMenu from './UserMenu.vue';

const ITEMS = [
  { key: 'profile', label: 'Edit profile' },
  { key: 'logout', label: 'Log out' },
];

const mountUserMenu = (props: Record<string, unknown> = {}) =>
  mount(UserMenu, {
    props: { name: 'Ann Lee', email: 'ann@example.com', items: ITEMS, ...props },
    attachTo: document.body,
  });

const chip = (wrapper: ReturnType<typeof mountUserMenu>) => wrapper.get('[data-testid="user-menu"]');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('UserMenu', () => {
  it('shows the name and its initial, falling back to the email', () => {
    expect(chip(mountUserMenu()).text()).toBe('AAnn Lee');
    expect(chip(mountUserMenu({ name: '' })).text()).toBe('Aann@example.com');
  });

  it('opens its menu from the chip and says so', async () => {
    const wrapper = mountUserMenu();

    expect(chip(wrapper).attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await chip(wrapper).trigger('click');

    expect(chip(wrapper).attributes('aria-expanded')).toBe('true');
    expect(chip(wrapper).attributes('aria-haspopup')).toBe('menu');
    expect(wrapper.get('[role="menu"]').text()).toContain('Log out');
  });

  it('closes and emits the item chosen', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[data-testid="menu-item-logout"]').trigger('click');

    expect(wrapper.emitted('select')).toEqual([['logout']]);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes on Escape and hands focus back to the chip', async () => {
    const wrapper = mountUserMenu();

    await chip(wrapper).trigger('click');
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' });

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(chip(wrapper).element);
  });
});
