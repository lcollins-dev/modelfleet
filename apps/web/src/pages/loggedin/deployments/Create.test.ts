import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import { ActivationPolicy } from '@libs/dto';

import { useNotificationStore } from '@/stores/notification';

import Create from './Create.vue';

const createDeployment = vi.fn();

vi.mock('@/services/api/admin/DeploymentAdminService', () => ({
  useDeploymentAdminService: () => ({ createDeployment }),
}));

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({
    getPresetList: vi.fn().mockResolvedValue({
      presetList: [{ id: 4, name: 'vLLM BF16', backend: BackendId.VLLM, description: null, deployments: 0 }],
      pages: 1,
    }),
    getPreset: vi.fn().mockResolvedValue({ name: 'vLLM BF16', backend: BackendId.VLLM, configuration: {} }),
  }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }) }),
}));

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList: vi.fn().mockResolvedValue({ nodeList: [], pages: 1 }) }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getNodeTelemetryStatus: vi.fn() }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ previewPlacement: vi.fn() }),
}));

const mountCreate = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/deployments/create');

  const wrapper = mount(Create, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  createDeployment.mockResolvedValue({ id: 7 });
});

describe('New deployment page', () => {
  it('creates the deployment from the form and opens it', async () => {
    const { wrapper, router } = await mountCreate();

    await wrapper.get('input[placeholder="llama-70b-chat"]').setValue('chat');

    const create = wrapper.findAll('button').find(button => button.text() === 'Create Deployment');

    await create?.trigger('click');
    await flushPromises();

    expect(createDeployment).toHaveBeenCalledWith({
      name: 'chat',
      modelId: 0,
      presetId: undefined,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ALWAYS,
      description: '',
      document: '',
    });
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Deployment created');
    expect(router.currentRoute.value.path).toBe('/deployments/7');

    wrapper.unmount();
  });

  it('creates on a preset alone, sending no backend of its own', async () => {
    const { wrapper } = await mountCreate();

    const presetSelect: VueWrapper | undefined = wrapper
      .findAllComponents({ name: 'Select' })
      .find(select => select.props('placeholder') === 'No preset');

    presetSelect?.vm.$emit('update:value', '4');
    await flushPromises();

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Create Deployment')
      ?.trigger('click');
    await flushPromises();

    expect(createDeployment).toHaveBeenCalledWith(expect.objectContaining({ presetId: 4, backend: undefined }));

    wrapper.unmount();
  });

  it('cancels back to the list', async () => {
    const { wrapper } = await mountCreate();

    const cancel = wrapper.findAll('a').find(link => link.text() === 'Cancel');

    expect(cancel?.attributes('href')).toBe('/deployments');

    wrapper.unmount();
  });
});
