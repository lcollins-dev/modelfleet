import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';

import { useNotificationStore } from '@/stores/notification';

import Create from './Create.vue';

const createPreset = vi.fn();

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({ createPreset }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }) }),
}));

const mountCreate = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/presets/create');

  const wrapper = mount(Create, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  createPreset.mockResolvedValue({ id: 4 });
});

describe('New preset page', () => {
  it('creates the preset from the form and opens it', async () => {
    const { wrapper, router } = await mountCreate();

    await wrapper.get('input[placeholder="vLLM BF16 throughput"]').setValue('standard');
    await wrapper.get('input[placeholder="Default: 1"]').setValue('2');
    await wrapper.get('input[placeholder="Default: 1"]').trigger('blur');

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Create Preset')
      ?.trigger('click');
    await flushPromises();

    expect(createPreset).toHaveBeenCalledWith({
      name: 'standard',
      description: '',
      backend: BackendId.LLAMA_CPP,
      document: 'replicas: 2\n',
    });
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Preset created');
    expect(router.currentRoute.value.path).toBe('/presets/4');

    wrapper.unmount();
  });

  it('offers the backend settings in a section rail, and cancels back to the list', async () => {
    const { wrapper } = await mountCreate();

    const settings = wrapper.get('[data-testid="preset-settings"]');

    expect(settings.get('nav[aria-label="Settings sections"]').text()).toContain('Backend');

    const cancel = wrapper.findAll('a').find(link => link.text() === 'Cancel');

    expect(cancel?.attributes('href')).toBe('/presets');

    wrapper.unmount();
  });
});
