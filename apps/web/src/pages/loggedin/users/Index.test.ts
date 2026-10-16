import { VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { ListUserDto } from '@libs/dto';
import { UserListStatus, UserRoleId } from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getUserList = vi.fn();
const getUserStats = vi.fn();

vi.mock('@/services/api/admin/UserAdminService', () => ({
  useUserAdminService: () => ({ getUserList, getUserStats }),
}));

const USERS: ListUserDto[] = [
  {
    id: 1,
    name: 'Ada Whitfield',
    email: 'ada@modelfleet.test',
    enabled: true,
    userRoleIds: [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN],
  },
  { id: 2, name: 'Tom Ferreira', email: 'tom@modelfleet.test', enabled: false, userRoleIds: [] },
];

const render = async (): Promise<VueWrapper> => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/users');

  const wrapper = mount(Index, { global: { plugins: [router] } });
  await flushPromises();

  return wrapper;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getUserList.mockResolvedValue({ userList: USERS, pages: 1 });
  getUserStats.mockResolvedValue({ total: 5, enabled: 4, disabled: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Users page', () => {
  it('lists each account with its access and state, linking through to it', async () => {
    const wrapper = await render();

    expect(getUserList).toHaveBeenCalledWith({ search: undefined, status: UserListStatus.ALL }, 1);

    const rows = wrapper.findAll('[data-testid="user-row"]');

    expect(rows).toHaveLength(2);
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/users/1');
    expect(rows[0].text()).toContain('Ada Whitfield');
    expect(rows[0].text()).toContain('ada@modelfleet.test');
    expect(rows[0].get('[data-testid="user-access"]').text()).toBe('Admin');
    expect(rows[0].text()).toContain('Enabled');
    expect(rows[1].get('[data-testid="user-access"]').text()).toBe('User');
    expect(rows[1].text()).toContain('Disabled');

    expect(wrapper.get('[data-testid="user-count"]').text()).toBe('Showing 2 of 5 accounts');
  });

  it('narrows to disabled accounts', async () => {
    const wrapper = await render();

    await wrapper.get('[role="radio"]:nth-child(3)').trigger('click');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(getUserList).toHaveBeenLastCalledWith({ search: undefined, status: UserListStatus.DISABLED }, 1);
  });

  it('says when a search matches no account', async () => {
    const wrapper = await render();

    getUserList.mockResolvedValue({ userList: [], pages: 1 });

    await wrapper.get('input').setValue('nobody');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);

    expect(getUserList).toHaveBeenLastCalledWith({ search: 'nobody', status: UserListStatus.ALL }, 1);
    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No accounts match your search.');
  });
});
