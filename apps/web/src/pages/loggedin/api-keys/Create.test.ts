import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { useNotificationStore } from '@/stores/notification';

import Create from './Create.vue';

const createApiKey = vi.fn();

vi.mock('@/services/api/admin/ApiKeyAdminService', () => ({
  useApiKeyAdminService: () => ({ createApiKey }),
}));

const CREATED = {
  apiKey: {
    id: 3,
    keyId: '0123456789abcdef01234567',
    name: 'nightly-eval',
    ownerId: 1,
    ownerName: 'Ada Whitfield',
    lastUsedDate: null,
    revokedDate: null,
    createdDate: new Date(),
  },
  token: 'mfk_0123456789abcdef01234567_s3cret',
};

const mountCreate = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/api-keys/create');

  const wrapper = mount(Create, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

const create = async (wrapper: Awaited<ReturnType<typeof mountCreate>>['wrapper']) => {
  await wrapper.get('input').setValue(' nightly-eval ');
  await wrapper.get('form').trigger('submit');
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });

  createApiKey.mockResolvedValue(CREATED);
});

describe('New API key page', () => {
  it('creates the key under its form and shows the token once', async () => {
    const { wrapper } = await mountCreate();

    await create(wrapper);

    expect(createApiKey).toHaveBeenCalledWith({ name: 'nightly-eval' }, 'create-api-key');

    const dialog = wrapper.get('dialog');

    expect(dialog.text()).toContain('Copy your key now');
    expect(dialog.text()).toContain('This is the only time you will see the secret.');
    expect(dialog.get('[data-testid="api-key-token"]').text()).toBe(CREATED.token);

    wrapper.unmount();
  });

  it('returns to the list with a toast once done', async () => {
    const { wrapper, router } = await mountCreate();

    await create(wrapper);

    const done = wrapper.findAll('button').find(button => button.text() === 'Done');

    await done?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/api-keys');
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Key created');

    wrapper.unmount();
  });

  it('stays on the form when the key is refused', async () => {
    createApiKey.mockRejectedValue(new Error('Validation failed'));

    const { wrapper, router } = await mountCreate();

    await create(wrapper);

    expect(wrapper.get('dialog').attributes('open')).toBeUndefined();
    expect(router.currentRoute.value.path).toBe('/api-keys/create');

    wrapper.unmount();
  });
});
