import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type { PresetDto } from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Preset from './Preset.vue';

const getPreset = vi.fn();
const getPresetImpact = vi.fn();
const updatePreset = vi.fn();
const deletePreset = vi.fn();

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({ getPreset, getPresetImpact, updatePreset, deletePreset }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }) }),
}));

const preset = (extra: Partial<PresetDto> = {}): PresetDto => ({
  id: 3,
  name: 'llama.cpp standard',
  description: 'Single 4090',
  backend: BackendId.LLAMA_CPP,
  deployments: 2,
  createdDate: new Date(),
  schemaVersion: 1,
  document: '# tuned\nreplicas: 2\n',
  configuration: { replicas: 2 },
  updatedDate: new Date(),
  ...extra,
});

const mountPreset = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/presets/:presetId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/presets/3');

  const wrapper = mount(Preset, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

const clickButton = async (wrapper: Awaited<ReturnType<typeof mountPreset>>['wrapper'], label: string) => {
  await wrapper
    .findAll('button')
    .find(button => button.text() === label)
    ?.trigger('click');
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getPreset.mockResolvedValue(preset());
  updatePreset.mockResolvedValue(undefined);
  deletePreset.mockResolvedValue(undefined);
});

describe('Preset page', () => {
  it('heads the page with the preset and its use, and locks the backend', async () => {
    const { wrapper } = await mountPreset();

    expect(wrapper.get('h1').text()).toBe('llama.cpp standard');
    expect(wrapper.text()).toContain('Used by 2 deployments.');
    expect(wrapper.get<HTMLInputElement>('input[placeholder="vLLM BF16 throughput"]').element.value).toBe(
      'llama.cpp standard'
    );

    const backend = wrapper.findAll('[data-testid="form-field"]').find(field => field.text().startsWith('Backend'));

    expect(backend?.get('input').attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });

  it('saves straight through when no deployment inherits a changed key, keeping the authored document', async () => {
    getPresetImpact.mockResolvedValue({ affectedDeployments: 0, changedFields: [] });

    const { wrapper } = await mountPreset();

    await wrapper.get('input[placeholder="vLLM BF16 throughput"]').setValue('renamed');
    await clickButton(wrapper, 'Save Changes');

    expect(getPresetImpact).toHaveBeenCalledWith(3, { document: '# tuned\nreplicas: 2\n' });
    expect(updatePreset).toHaveBeenCalledWith(3, {
      name: 'renamed',
      description: 'Single 4090',
      document: '# tuned\nreplicas: 2\n',
    });
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Preset saved');

    wrapper.unmount();
  });

  it('names the inheriting deployments a save moves, and saves only once confirmed', async () => {
    getPresetImpact.mockResolvedValue({
      affectedDeployments: 2,
      changedFields: [{ key: 'replicas', inheritingDeployments: 2 }],
    });

    const { wrapper } = await mountPreset();

    await clickButton(wrapper, 'Save Changes');

    const dialogStore = useDialogStore();

    expect(updatePreset).not.toHaveBeenCalled();
    expect(dialogStore.top?.options.title).toBe('Save llama.cpp standard?');

    await dialogStore.top?.options.action?.();

    expect(updatePreset).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('deletes the preset once confirmed, warning first when deployments use it', async () => {
    const { wrapper, router } = await mountPreset();

    expect(wrapper.text()).toContain('2 deployments use it.');

    await clickButton(wrapper, 'Delete Preset');

    const dialogStore = useDialogStore();

    expect(dialogStore.top?.options.title).toBe('Delete llama.cpp standard?');
    expect(dialogStore.top?.options.message).toContain('2 deployments use this preset.');

    await dialogStore.top?.options.action?.();
    await flushPromises();

    expect(deletePreset).toHaveBeenCalledWith(3);
    expect(router.currentRoute.value.path).toBe('/presets');

    wrapper.unmount();
  });

  it('says so when the preset cannot be loaded', async () => {
    getPreset.mockRejectedValue(new Error('gone'));

    const { wrapper } = await mountPreset();

    expect(wrapper.text()).toContain('Could not load this preset.');

    wrapper.unmount();
  });
});
