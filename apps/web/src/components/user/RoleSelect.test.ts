import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import RoleSelect from './RoleSelect.vue';

const getRoleList = vi.fn();

vi.mock('@/services/api/admin/UserAdminService', () => ({
  useUserAdminService: () => ({ getRoleList }),
}));

const ROLE_LIST = [
  { id: UserRoleId.USER_ADMIN, name: 'User Admin' },
  { id: UserRoleId.SYSTEM_ADMIN, name: 'System Admin' },
];

const mountRoleSelect = async (value: number[], attrs: Record<string, unknown> = {}) => {
  getRoleList.mockResolvedValue(ROLE_LIST);

  const wrapper = mount(RoleSelect, {
    props: { value, name: 'roles' },
    attrs,
    attachTo: document.body,
    global: { stubs: { teleport: true } },
  });
  await flushPromises();

  return wrapper;
};

type RoleSelectWrapper = Awaited<ReturnType<typeof mountRoleSelect>>;

const combobox = (wrapper: RoleSelectWrapper) => wrapper.get('input[role="combobox"]');

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RoleSelect', () => {
  it('shows each picked role by its name', async () => {
    const wrapper = await mountRoleSelect([UserRoleId.SYSTEM_ADMIN]);

    expect(wrapper.findAll('[data-testid="multi-select-chip"]').map(chip => chip.text())).toEqual(['System Admin']);
  });

  it('offers every role and emits the picked role ids', async () => {
    const wrapper = await mountRoleSelect([UserRoleId.SYSTEM_ADMIN]);

    await combobox(wrapper).trigger('keydown', { key: 'ArrowDown' });

    expect(wrapper.findAll('[role="option"]').map(option => option.text())).toEqual(['User Admin', 'System Admin']);

    await combobox(wrapper).trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('update:value')).toEqual([[[UserRoleId.SYSTEM_ADMIN, UserRoleId.USER_ADMIN]]]);
  });

  it('passes a form field input attrs and name to its control', async () => {
    const wrapper = await mountRoleSelect([UserRoleId.USER_ADMIN], { id: 'roles-input', 'aria-invalid': true });

    expect(combobox(wrapper).attributes('id')).toBe('roles-input');
    expect(combobox(wrapper).attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('input[type="hidden"]').attributes()).toMatchObject({
      name: 'roles',
      value: String(UserRoleId.USER_ADMIN),
    });
  });
});
