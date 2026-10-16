import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserRoleId } from '@libs/dto';

import { ApiValidationError } from '@/types/api/error';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';

import FirstTimeSetup from './FirstTimeSetup.vue';

const updateProfile = vi.fn();
const logout = vi.fn();
const push = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ updateProfile, logout }),
}));

const mountSetup = () => mount(FirstTimeSetup);

type SetupWrapper = ReturnType<typeof mountSetup>;

const fieldError = (wrapper: SetupWrapper, label: string) =>
  wrapper
    .findAll('[data-testid="form-field"]')
    .find(field => field.find('label').text() === label)
    ?.find('[data-testid="field-error"]');

const fillPasswords = async (wrapper: SetupWrapper, password: string, confirmPassword: string) => {
  await wrapper.find('input[name="new-password"]').setValue(password);
  await wrapper.find('input[name="confirm-password"]').setValue(confirmPassword);
};

const submit = async (wrapper: SetupWrapper) => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  updateProfile.mockReset();
  logout.mockReset();
  push.mockReset();

  useUserStore().setProfile({
    name: 'Admin',
    email: 'admin@modelfleet.test',
    userRoleIds: [UserRoleId.SYSTEM_ADMIN],
    mustChangePassword: true,
  });
});

describe('FirstTimeSetup', () => {
  it('asks for a new password without assuming the account is the seeded admin', () => {
    const wrapper = mountSetup();

    expect(wrapper.text()).toContain('Set your own password to continue');
    expect(wrapper.text()).not.toContain('default admin');
  });

  it('starts from the email on the profile', () => {
    const wrapper = mountSetup();

    expect(wrapper.find<HTMLInputElement>('input[name="email"]').element.value).toBe('admin@modelfleet.test');
  });

  it('refuses mismatched passwords under the confirmation without calling the api', async () => {
    const wrapper = mountSetup();

    await fillPasswords(wrapper, 'New-pass1!', 'Other-pass1!');
    await submit(wrapper);

    expect(fieldError(wrapper, 'Confirm password')?.text()).toBe("The passwords don't match.");
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('saves the email and new password, keeping the name, then goes to the dashboard', async () => {
    updateProfile.mockResolvedValue(undefined);
    push.mockResolvedValue(undefined);

    const wrapper = mountSetup();

    await wrapper.find('input[name="email"]').setValue(' me@example.com ');
    await fillPasswords(wrapper, 'New-pass1!', 'New-pass1!');
    await submit(wrapper);

    expect(updateProfile).toHaveBeenCalledWith(
      { name: 'Admin', email: 'me@example.com', password: 'New-pass1!' },
      'setup'
    );
    expect(push).toHaveBeenCalledWith('/dashboard');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Account set up');
  });

  it("shows the api's refusal of the initial password under the new password", async () => {
    updateProfile.mockImplementation(() => {
      const error = new ApiValidationError('setup', {
        password: { name: 'Password', message: 'Choose a new password, not the one you signed in with' },
      });
      useErrorStore().setValidationError(error);

      return Promise.reject(error);
    });

    const wrapper = mountSetup();

    await fillPasswords(wrapper, 'Initial-pass1!', 'Initial-pass1!');
    await submit(wrapper);

    expect(fieldError(wrapper, 'New password')?.text()).toBe('Choose a new password, not the one you signed in with');
    expect(push).not.toHaveBeenCalled();
  });

  it('signs out from the setup page', async () => {
    logout.mockResolvedValue(undefined);

    const wrapper = mountSetup();

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Sign out')
      ?.trigger('click');

    expect(logout).toHaveBeenCalled();
  });
});
