import { VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { UserDto } from '@libs/dto';
import { EventPartyType, UserRoleId } from '@libs/dto';

import { DialogType } from '@/types/dialog';

import { PASSWORD_MISMATCH } from '@/utils/password';

import { useDialogStore } from '@/stores/dialog';
import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import User from './User.vue';

const getUser = vi.fn();
const getRoleList = vi.fn();
const updateUser = vi.fn();
const updateState = vi.fn();
const logoutAllSessions = vi.fn();
const getEventList = vi.fn();

vi.mock('@/services/api/admin/UserAdminService', () => ({
  useUserAdminService: () => ({ getUser, getRoleList, updateUser, updateState, logoutAllSessions }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ getEventList }),
}));

const user = (overrides: Partial<UserDto> = {}): UserDto => ({
  id: 4,
  name: 'Rita Okonjo',
  email: 'rita@modelfleet.test',
  enabled: true,
  userRoleIds: [UserRoleId.USER_ADMIN],
  lastLoginSuccess: new Date('2026-10-13T12:41:00.000Z'),
  lastLoginFail: null,
  lastAccess: new Date('2026-10-13T13:00:00.000Z'),
  createdDate: new Date('2026-02-04T09:00:00.000Z'),
  ...overrides,
});

const render = async (roles: UserRoleId[] = [UserRoleId.USER_ADMIN, UserRoleId.SYSTEM_ADMIN]): Promise<VueWrapper> => {
  useUserStore().setProfile({
    name: 'Ada',
    email: 'ada@modelfleet.test',
    userRoleIds: roles,
    mustChangePassword: false,
  });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/users/:userId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/users/4');

  const wrapper = mount(User, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return wrapper;
};

const buttonNamed = (wrapper: VueWrapper, label: string) => {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === label);

  if (button === undefined) {
    throw new Error(`No button named ${label}`);
  }

  return button;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getUser.mockResolvedValue(user());
  getRoleList.mockResolvedValue([
    { id: UserRoleId.USER_ADMIN, name: 'User Admin' },
    { id: UserRoleId.SYSTEM_ADMIN, name: 'System Admin' },
  ]);
  updateUser.mockResolvedValue(undefined);
  updateState.mockResolvedValue(undefined);
  logoutAllSessions.mockResolvedValue(undefined);
  getEventList.mockResolvedValue({ eventList: [], pages: 1 });
});

describe('User page', () => {
  it('heads the page with the account, its access and state, and fills the profile', async () => {
    const wrapper = await render();

    expect(getUser).toHaveBeenCalledWith(4);
    expect(wrapper.get('h1').text()).toBe('Rita Okonjo');
    expect(wrapper.get('[data-testid="user-email"]').text()).toBe('rita@modelfleet.test');
    expect(wrapper.get('[data-testid="user-access"]').text()).toBe('User admin');
    expect(wrapper.get('[data-testid="user-state"]').text()).toBe('Enabled');
    expect(wrapper.text()).toContain('No failed attempts');
    expect(wrapper.get<HTMLInputElement>('input[name="display-name"]').element.value).toBe('Rita Okonjo');

    wrapper.unmount();
  });

  it('says when the user cannot be loaded', async () => {
    getUser.mockRejectedValue(new Error('gone'));

    const wrapper = await render();

    expect(wrapper.text()).toContain('Could not load this user.');

    wrapper.unmount();
  });

  it('saves the profile with its roles under the profile form', async () => {
    const wrapper = await render();

    expect(buttonNamed(wrapper, 'Save').attributes('disabled')).toBeDefined();

    await wrapper.get('input[name="display-name"]').setValue('Rita O');
    await wrapper.findAll('form')[0].trigger('submit');
    await flushPromises();

    expect(updateUser).toHaveBeenCalledWith(
      { name: 'Rita O', email: 'rita@modelfleet.test', userRoleIds: [UserRoleId.USER_ADMIN] },
      4,
      'user-profile'
    );
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Profile updated');
    expect(getUser).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });

  it('sets a new password once confirmed, sending the saved profile with it', async () => {
    const wrapper = await render();

    await wrapper.get('input[name="new-password"]').setValue('S3cret$Pass');
    await wrapper.get('input[name="confirm-password"]').setValue('S3cret$Pass');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();

    const dialog = useDialogStore().top;

    expect(dialog?.options).toMatchObject({ type: DialogType.WARNING, confirmLabel: 'Set Password' });
    expect(updateUser).not.toHaveBeenCalled();

    if (dialog !== null) {
      useDialogStore().close(dialog, true);
    }
    await flushPromises();

    expect(updateUser).toHaveBeenCalledWith(
      {
        name: 'Rita Okonjo',
        email: 'rita@modelfleet.test',
        userRoleIds: [UserRoleId.USER_ADMIN],
        password: 'S3cret$Pass',
      },
      4,
      'user-password'
    );
    expect(wrapper.get<HTMLInputElement>('input[name="new-password"]').element.value).toBe('');

    wrapper.unmount();
  });

  it('reports mismatched passwords without asking or calling the api', async () => {
    const wrapper = await render();

    await wrapper.get('input[name="new-password"]').setValue('S3cret$Pass');
    await wrapper.get('input[name="confirm-password"]').setValue('S3cret$Pas');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();

    expect(useDialogStore().top).toBeNull();
    expect(useErrorStore().getFieldError('user-password', 'confirmPassword')).toBe(PASSWORD_MISMATCH);

    wrapper.unmount();
  });

  it('disables the account through a confirm dialog and enables it straight away', async () => {
    const wrapper = await render();

    await buttonNamed(wrapper, 'Disable').trigger('click');

    const dialog = useDialogStore().top;

    expect(dialog?.options).toMatchObject({ title: 'Disable Rita Okonjo?', confirmLabel: 'Disable Account' });

    getUser.mockResolvedValue(user({ enabled: false }));
    await dialog?.options.action?.();
    await flushPromises();

    expect(updateState).toHaveBeenCalledWith({ enabled: false }, 4);
    expect(wrapper.get('[data-testid="user-state"]').text()).toBe('Disabled');

    await buttonNamed(wrapper, 'Enable').trigger('click');
    await flushPromises();

    expect(updateState).toHaveBeenLastCalledWith({ enabled: true }, 4);
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Account enabled');

    wrapper.unmount();
  });

  it('signs the user out everywhere once confirmed', async () => {
    const wrapper = await render();

    await buttonNamed(wrapper, 'Sign Out').trigger('click');
    await useDialogStore().top?.options.action?.();
    await flushPromises();

    expect(logoutAllSessions).toHaveBeenCalledWith(4);
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Signed out everywhere');

    wrapper.unmount();
  });

  it('shows what the user did to a system admin', async () => {
    const wrapper = await render();

    expect(getEventList).toHaveBeenCalledWith({ actorType: EventPartyType.USER, actorId: '4' }, 1);
    expect(wrapper.find('[data-testid="activity-card"]').exists()).toBe(true);

    wrapper.unmount();
  });

  it('leaves the activity out for a user admin who cannot read the event log', async () => {
    const wrapper = await render([UserRoleId.USER_ADMIN]);

    expect(getEventList).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="activity-card"]').exists()).toBe(false);

    wrapper.unmount();
  });
});
