import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { UserRoleId } from '@libs/dto';

import { PASSWORD_MISMATCH } from '@/utils/password';

import { useErrorStore } from '@/stores/error';
import { useNotificationStore } from '@/stores/notification';

import Create from './Create.vue';

const createUser = vi.fn();
const getRoleList = vi.fn();

vi.mock('@/services/api/admin/UserAdminService', () => ({
  useUserAdminService: () => ({ createUser, getRoleList }),
}));

const render = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/users/create');

  const wrapper = mount(Create, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

const fill = async (wrapper: Awaited<ReturnType<typeof render>>['wrapper'], confirmPassword = 'S3cret$Pass') => {
  await wrapper.get('input[name="display-name"]').setValue('Rita Okonjo');
  await wrapper.get('input[name="email"]').setValue('rita@modelfleet.test');
  await wrapper.get('input[name="new-password"]').setValue('S3cret$Pass');
  await wrapper.get('input[name="confirm-password"]').setValue(confirmPassword);
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  createUser.mockResolvedValue(12);
  getRoleList.mockResolvedValue([
    { id: UserRoleId.USER_ADMIN, name: 'User Admin' },
    { id: UserRoleId.SYSTEM_ADMIN, name: 'System Admin' },
  ]);
});

describe('New user page', () => {
  it('creates the account under its form and opens it', async () => {
    const { wrapper, router } = await render();

    await fill(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(createUser).toHaveBeenCalledWith(
      { name: 'Rita Okonjo', email: 'rita@modelfleet.test', userRoleIds: [], password: 'S3cret$Pass' },
      'create-user'
    );
    expect(router.currentRoute.value.path).toBe('/users/12');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('User created');

    wrapper.unmount();
  });

  it('reports mismatched passwords under the confirm field without calling the api', async () => {
    const { wrapper } = await render();

    await fill(wrapper, 'S3cret$Pas');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(createUser).not.toHaveBeenCalled();
    expect(useErrorStore().getFieldError('create-user', 'confirmPassword')).toBe(PASSWORD_MISMATCH);
    expect(wrapper.find('[data-testid="field-error"]').text()).toBe(PASSWORD_MISMATCH);

    wrapper.unmount();
  });
});
