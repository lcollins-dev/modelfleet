import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type { DeploymentConfigurationDto, DeploymentDto } from '@libs/dto';
import { ActivationPolicy, ConfigurationSource } from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Configuration from './Configuration.vue';

const getDeployment = vi.fn();
const getDeploymentConfiguration = vi.fn();
const updateDeployment = vi.fn();
const previewPresetSwap = vi.fn();
const getDeploymentInstances = vi.fn();

vi.mock('@/services/api/admin/DeploymentAdminService', () => ({
  useDeploymentAdminService: () => ({ getDeployment, getDeploymentConfiguration, updateDeployment, previewPresetSwap }),
}));

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({
    getPresetList: vi.fn().mockResolvedValue({
      presetList: [
        {
          id: 2,
          name: 'llama.cpp standard',
          description: null,
          backend: BackendId.LLAMA_CPP,
          deployments: 1,
          createdDate: new Date(),
        },
      ],
      pages: 1,
    }),
    getPreset: vi.fn().mockResolvedValue({ name: 'vLLM', backend: BackendId.VLLM, configuration: {} }),
  }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({
    getModelList: vi.fn().mockResolvedValue({ modelList: [], pages: 1 }),
    getModel: vi.fn().mockReturnValue(new Promise(() => undefined)),
  }),
}));

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList: vi.fn().mockResolvedValue({ nodeList: [], pages: 1 }) }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getNodeTelemetryStatus: vi.fn() }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ previewPlacement: vi.fn(), getDeploymentInstances }),
}));

const deployment = (extra: Partial<DeploymentDto> = {}): DeploymentDto => ({
  id: 5,
  name: 'llama-70b-chat',
  modelId: 9,
  modelName: 'Llama-3.1-70B',
  modelLicence: null,
  presetId: null,
  presetName: null,
  backend: BackendId.LLAMA_CPP,
  activationPolicy: ActivationPolicy.ALWAYS,
  enabled: true,
  outOfDate: false,
  createdDate: new Date(),
  description: null,
  schemaVersion: 1,
  document: 'replicas: 2\n',
  overrides: { replicas: 2 },
  updatedDate: new Date(),
  ...extra,
});

const CONFIGURATION: DeploymentConfigurationDto = {
  backend: BackendId.LLAMA_CPP,
  entries: [{ key: 'replicas', value: 2, source: ConfigurationSource.DEPLOYMENT, modelled: true }],
  configuration: { replicas: 2 },
  presetId: null,
  presetName: null,
};

const mountConfiguration = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments/:deploymentId/configuration', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/deployments/5/configuration');

  const wrapper = mount(Configuration, { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();

  return { wrapper, router };
};

const save = async (wrapper: Awaited<ReturnType<typeof mountConfiguration>>['wrapper']) => {
  await wrapper
    .findAll('button')
    .find(button => button.text() === 'Save Changes')
    ?.trigger('click');
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getDeployment.mockResolvedValue(deployment());
  getDeploymentConfiguration.mockResolvedValue(CONFIGURATION);
  updateDeployment.mockResolvedValue(undefined);
  getDeploymentInstances.mockResolvedValue({ instances: [], placement: { nodes: [], problem: null }, residency: null });
});

describe('Deployment settings page', () => {
  it('names the nodes a pinned placement holds in the applied settings', async () => {
    getDeploymentConfiguration.mockResolvedValue({
      ...CONFIGURATION,
      entries: [{ key: 'placement', value: { nodeIds: [1] }, source: ConfigurationSource.DEPLOYMENT, modelled: true }],
    });
    getDeploymentInstances.mockResolvedValue({
      instances: [],
      placement: {
        nodes: [
          {
            nodeId: 1,
            nodeName: 'rig-a',
            devices: [],
            replicas: 1,
            running: 0,
            problem: null,
            expectedUsage: null,
            capacity: null,
          },
        ],
        problem: null,
      },
      residency: null,
    });

    const { wrapper } = await mountConfiguration();

    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Applied')
      ?.trigger('click');

    expect(getDeploymentInstances).toHaveBeenCalledWith(5);
    expect(wrapper.get('[data-testid="effective-entry"]').text()).toContain('rig-a: CPU');

    wrapper.unmount();
  });

  it('heads the editor with the deployment, and flags changes waiting to be applied', async () => {
    getDeployment.mockResolvedValue(deployment({ outOfDate: true }));

    const { wrapper } = await mountConfiguration();

    expect(wrapper.get('h1').text()).toBe('Edit settings');
    expect(wrapper.text()).toContain('llama-70b-chat · holds its own settings');
    expect(wrapper.text()).toContain('Changes waiting to be applied');
    expect(wrapper.get<HTMLInputElement>('input[placeholder="llama-70b-chat"]').element.value).toBe('llama-70b-chat');

    wrapper.unmount();
  });

  it('saves the form as it stands and returns to the deployment', async () => {
    const { wrapper, router } = await mountConfiguration();

    await save(wrapper);

    expect(previewPresetSwap).not.toHaveBeenCalled();
    expect(updateDeployment).toHaveBeenCalledWith(5, {
      name: 'llama-70b-chat',
      modelId: 9,
      presetId: null,
      backend: BackendId.LLAMA_CPP,
      activationPolicy: ActivationPolicy.ALWAYS,
      description: '',
      document: 'replicas: 2\n',
    });
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Settings saved');
    expect(router.currentRoute.value.path).toBe('/deployments/5');

    wrapper.unmount();
  });

  it('saves a deployment on a preset with no backend of its own', async () => {
    getDeployment.mockResolvedValue(deployment({ presetId: 2, presetName: 'llama.cpp standard' }));
    getDeploymentConfiguration.mockResolvedValue({ ...CONFIGURATION, presetId: 2, presetName: 'llama.cpp standard' });

    const { wrapper } = await mountConfiguration();

    await save(wrapper);

    expect(updateDeployment).toHaveBeenCalledWith(5, expect.objectContaining({ presetId: 2, backend: null }));

    wrapper.unmount();
  });

  it('names the overrides a preset swap drops, and saves only once confirmed', async () => {
    getDeployment.mockResolvedValue(deployment({ presetId: 2, presetName: 'llama.cpp standard' }));
    getDeploymentConfiguration.mockResolvedValue({ ...CONFIGURATION, presetId: 2, presetName: 'llama.cpp standard' });
    previewPresetSwap.mockResolvedValue({ backend: BackendId.VLLM, presetName: 'vLLM', droppedKeys: ['ctxSize'] });

    const { wrapper } = await mountConfiguration();

    const presetField = wrapper.findAll('[data-testid="form-field"]').find(field => field.text().startsWith('Preset'));

    await presetField?.get('[aria-label="Clear"]').trigger('click');
    await save(wrapper);

    const dialogStore = useDialogStore();

    expect(previewPresetSwap).toHaveBeenCalledWith(5, {
      presetId: null,
      backend: BackendId.LLAMA_CPP,
      document: 'replicas: 2\n',
    });
    expect(updateDeployment).not.toHaveBeenCalled();
    expect(dialogStore.top?.options.title).toBe('Move llama-70b-chat to another preset?');

    await dialogStore.top?.options.action?.();

    expect(updateDeployment).toHaveBeenCalled();

    wrapper.unmount();
  });
});
