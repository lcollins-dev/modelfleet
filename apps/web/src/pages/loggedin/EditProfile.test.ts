import { VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PASSWORD_MISMATCH } from '@/utils/password';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import EditProfile from './EditProfile.vue';

const updateProfile = vi.fn();

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ updateProfile }),
}));

const render = async (): Promise<VueWrapper> => {
  const wrapper = mount(EditProfile, { attachTo: document.body });
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

  useUserStore().setProfile({
    name: 'Ada Whitfield',
    email: 'ada@modelfleet.test',
    userRoleIds: [],
    mustChangePassword: false,
  });
  updateProfile.mockResolvedValue(undefined);
});

describe('Profile and security page', () => {
  it('fills the profile from the signed-in user and saves only once it changes', async () => {
    const wrapper = await render();

    expect(wrapper.text()).toContain('ada@modelfleet.test');
    expect(wrapper.get<HTMLInputElement>('input[name="display-name"]').element.value).toBe('Ada Whitfield');
    expect(buttonNamed(wrapper, 'Save').attributes('disabled')).toBeDefined();

    await wrapper.get('input[name="display-name"]').setValue('Ada W');
    await wrapper.findAll('form')[0].trigger('submit');
    await flushPromises();

    expect(updateProfile).toHaveBeenCalledWith({ name: 'Ada W', email: 'ada@modelfleet.test' }, 'profile');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Profile updated');

    wrapper.unmount();
  });

  it('changes the password under its own form with the saved name and email, then clears it', async () => {
    const wrapper = await render();

    await wrapper.get('input[name="display-name"]').setValue('Unsaved edit');
    await wrapper.get('input[name="new-password"]').setValue('Chang3d$Pass');
    await wrapper.get('input[name="confirm-password"]').setValue('Chang3d$Pass');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();

    expect(updateProfile).toHaveBeenCalledWith(
      { name: 'Ada Whitfield', email: 'ada@modelfleet.test', password: 'Chang3d$Pass' },
      'password'
    );
    expect(wrapper.get<HTMLInputElement>('input[name="new-password"]').element.value).toBe('');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Password changed');

    wrapper.unmount();
  });

  it('reports mismatched passwords without calling the api', async () => {
    const wrapper = await render();

    await wrapper.get('input[name="new-password"]').setValue('An0ther$Pass');
    await wrapper.get('input[name="confirm-password"]').setValue('An0ther$Pas');
    await wrapper.findAll('form')[1].trigger('submit');
    await flushPromises();

    expect(updateProfile).not.toHaveBeenCalled();
    expect(useErrorStore().getFieldError('password', 'confirmPassword')).toBe(PASSWORD_MISMATCH);

    wrapper.unmount();
  });
});
