import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiValidationError } from '@/types/api/error';

import { useErrorStore } from '@/stores/error';

import SignIn from './SignIn.vue';

const login = vi.fn();

vi.mock('@/services/api/UserService', () => ({
  useUserService: () => ({ login }),
}));

const mountSignIn = () => mount(SignIn);

type SignInWrapper = ReturnType<typeof mountSignIn>;

const fieldError = (wrapper: SignInWrapper, label: string) =>
  wrapper
    .findAll('[data-testid="form-field"]')
    .find(field => field.find('label').text() === label)
    ?.find('[data-testid="field-error"]');

const submit = async (wrapper: SignInWrapper) => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

const continueAs = async (wrapper: SignInWrapper, email: string) => {
  await wrapper.find('input[name="email"]').setValue(email);
  await submit(wrapper);
};

beforeEach(() => {
  setActivePinia(createPinia());
  login.mockReset();
});

describe('SignIn', () => {
  it('asks for an email before moving to the password step', async () => {
    const wrapper = mountSignIn();

    await submit(wrapper);

    expect(fieldError(wrapper, 'Email')?.text()).toBe('Enter your email.');
    expect(wrapper.find('input[name="password"]').exists()).toBe(false);
  });

  it('moves to the password step showing the trimmed email', async () => {
    const wrapper = mountSignIn();

    await continueAs(wrapper, '  admin@modelfleet.test ');

    expect(wrapper.find('h1').text()).toBe('Enter your password');
    expect(wrapper.find('[data-testid="identity"]').text()).toBe('admin@modelfleet.test');
    expect(wrapper.find('input[name="password"]').exists()).toBe(true);
  });

  it('goes back to the email step from Change, keeping the email and dropping the password', async () => {
    const wrapper = mountSignIn();

    await continueAs(wrapper, 'admin@modelfleet.test');
    await wrapper.find('input[name="password"]').setValue('secret');
    await wrapper.find('[data-testid="identity"] + button').trigger('click');

    expect(wrapper.find<HTMLInputElement>('input[name="email"]').element.value).toBe('admin@modelfleet.test');

    await submit(wrapper);

    expect(wrapper.find<HTMLInputElement>('input[name="password"]').element.value).toBe('');
  });

  it('asks for a password before signing in', async () => {
    const wrapper = mountSignIn();

    await continueAs(wrapper, 'admin@modelfleet.test');
    await submit(wrapper);

    expect(fieldError(wrapper, 'Password')?.text()).toBe('Enter your password.');
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with the email and password under its form name', async () => {
    login.mockResolvedValue({ token: 'token' });

    const wrapper = mountSignIn();

    await continueAs(wrapper, 'admin@modelfleet.test');
    await wrapper.find('input[name="password"]').setValue('secret');
    await submit(wrapper);

    expect(login).toHaveBeenCalledWith({ email: 'admin@modelfleet.test', password: 'secret' }, 'sign-in');
  });

  it('shows the loading button while signing in', async () => {
    login.mockReturnValue(new Promise(() => undefined));

    const wrapper = mountSignIn();

    await continueAs(wrapper, 'admin@modelfleet.test');
    await wrapper.find('input[name="password"]').setValue('secret');
    await submit(wrapper);

    const button = wrapper.find('button[type="submit"]');

    expect(button.text()).toBe('Signing in...');
    expect(button.attributes('aria-busy')).toBe('true');
    expect(wrapper.find('input[name="password"]').attributes('disabled')).toBeDefined();
  });

  it("shows the api's refusal of the password under its field on the password step", async () => {
    login.mockImplementation(() => {
      const error = new ApiValidationError('sign-in', {
        password: { name: 'Password', message: 'The email address or password is incorrect' },
      });
      useErrorStore().setValidationError(error);

      return Promise.reject(error);
    });

    const wrapper = mountSignIn();

    await continueAs(wrapper, 'admin@modelfleet.test');
    await wrapper.find('input[name="password"]').setValue('wrong');
    await submit(wrapper);

    expect(fieldError(wrapper, 'Password')?.text()).toBe('The email address or password is incorrect');
    expect(wrapper.find('button[type="submit"]').text()).toBe('Sign In');
  });

  it("returns to the email step with the api's refusal of the email under its field", async () => {
    login.mockImplementation(() => {
      const error = new ApiValidationError('sign-in', { email: { name: 'Email', message: 'Enter a valid email.' } });
      useErrorStore().setValidationError(error);

      return Promise.reject(error);
    });

    const wrapper = mountSignIn();

    await continueAs(wrapper, 'someone@localhost');
    await wrapper.find('input[name="password"]').setValue('secret');
    await submit(wrapper);

    expect(wrapper.find('input[name="password"]').exists()).toBe(false);
    expect(fieldError(wrapper, 'Email')?.text()).toBe('Enter a valid email.');
  });
});
