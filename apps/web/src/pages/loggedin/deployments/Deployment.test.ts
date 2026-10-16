import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type {
  DeploymentConfigurationDto,
  DeploymentDto,
  DeploymentInstancesResponseDto,
  ListInstanceDto,
  PlacementNodeDto,
} from '@libs/dto';
import { ActivationPolicy, ConfigurationSource, InstanceState, NodeState, ResidencyRule } from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Deployment from './Deployment.vue';

const getDeployment = vi.fn();
const getDeploymentConfiguration = vi.fn();
const applyDeployment = vi.fn();
const updateDeploymentState = vi.fn();
const deleteDeployment = vi.fn();
const getEventList = vi.fn();
const streamEvents = vi.fn();
const getDeploymentInstances = vi.fn();
const streamDeploymentInstances = vi.fn();
const startDeployment = vi.fn();
const stopDeployment = vi.fn();

vi.mock('@/services/api/admin/DeploymentAdminService', () => ({
  useDeploymentAdminService: () => ({
    getDeployment,
    getDeploymentConfiguration,
    applyDeployment,
    updateDeploymentState,
    deleteDeployment,
  }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ getEventList, streamEvents }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({
    getDeploymentInstances,
    streamDeploymentInstances,
    startDeployment,
    stopDeployment,
  }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const deployment = (extra: Partial<DeploymentDto> = {}): DeploymentDto => ({
  id: 5,
  name: 'llama-70b-chat',
  modelId: 9,
  modelName: 'Llama-3.1-70B',
  modelLicence: null,
  presetId: 2,
  presetName: 'llama.cpp standard',
  backend: BackendId.LLAMA_CPP,
  activationPolicy: ActivationPolicy.ALWAYS,
  enabled: true,
  outOfDate: false,
  createdDate: new Date(),
  description: null,
  schemaVersion: 1,
  document: '',
  overrides: {},
  updatedDate: new Date(),
  ...extra,
});

const CONFIGURATION: DeploymentConfigurationDto = {
  backend: BackendId.LLAMA_CPP,
  entries: [{ key: 'replicas', value: 2, source: ConfigurationSource.DEPLOYMENT, modelled: true }],
  configuration: { replicas: 2 },
  presetId: 2,
  presetName: 'llama.cpp standard',
};

const instance = (extra: Partial<ListInstanceDto> = {}): ListInstanceDto => ({
  instanceKey: 'i-1',
  deploymentId: 5,
  deploymentName: 'llama-70b-chat',
  nodeId: 3,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [{ deviceKey: 'GPU-1', name: 'NVIDIA A100-SXM4-80GB' }],
  state: InstanceState.READY,
  message: null,
  exitCode: null,
  startedDate: new Date(),
  reportedDate: new Date(),
  createdDate: new Date(),
  ...extra,
});

const placementNode = (extra: Partial<PlacementNodeDto> = {}): PlacementNodeDto => ({
  nodeId: 3,
  nodeName: 'gpu-a-01',
  devices: [],
  replicas: 2,
  running: 1,
  problem: null,
  expectedUsage: null,
  capacity: null,
  ...extra,
});

const instancesResponse = (extra: Partial<DeploymentInstancesResponseDto> = {}): DeploymentInstancesResponseDto => ({
  instances: [instance()],
  placement: { nodes: [placementNode()], problem: null },
  residency: {
    rule: ResidencyRule.ALWAYS,
    idleTimeoutMs: null,
    lastUsedDate: null,
    idleSince: null,
    inFlight: 3,
    launchFailures: 0,
    retryDate: null,
    givenUp: false,
    lastLaunchFailure: null,
  },
  ...extra,
});

const mountDeployment = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments/:deploymentId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/deployments/5');

  const wrapper = mount(Deployment, { global: { plugins: [router] } });
  await flushPromises();

  return { wrapper, router };
};

const buttonNamed = (wrapper: Awaited<ReturnType<typeof mountDeployment>>['wrapper'], label: string) => {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === label);

  if (button === undefined) {
    throw new Error(`No button named ${label}`);
  }

  return button;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getDeployment.mockResolvedValue(deployment());
  getDeploymentConfiguration.mockResolvedValue(CONFIGURATION);
  getEventList.mockResolvedValue({ eventList: [], pages: 1 });
  getDeploymentInstances.mockResolvedValue(instancesResponse());
  applyDeployment.mockResolvedValue(undefined);
  updateDeploymentState.mockResolvedValue(undefined);
  deleteDeployment.mockResolvedValue(undefined);
  startDeployment.mockResolvedValue({ started: 1, refused: [] });
  stopDeployment.mockResolvedValue(undefined);
  streamEvents.mockImplementation(subscription);
  streamDeploymentInstances.mockImplementation(subscription);
});

describe('Deployment page', () => {
  it('heads the page with its name, model and preset, linking to its settings', async () => {
    const { wrapper } = await mountDeployment();

    expect(wrapper.get('h1').text()).toBe('llama-70b-chat');
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('Llama-3.1-70B on llama.cpp · preset llama.cpp standard');
    expect(wrapper.get('a[href="/deployments/5/configuration"]').text()).toBe('Edit Settings');
    expect(wrapper.get('[data-testid="deployment-model-link"]').attributes('href')).toBe('/models/9');
    expect(wrapper.get('[data-testid="deployment-preset-link"]').attributes('href')).toBe('/presets/2');
  });

  it('links no preset for a deployment on its own settings', async () => {
    getDeployment.mockResolvedValue(deployment({ presetId: null, presetName: null }));

    const { wrapper } = await mountDeployment();

    expect(wrapper.text()).toContain('Llama-3.1-70B on llama.cpp · its own settings');
    expect(wrapper.find('[data-testid="deployment-preset-link"]').exists()).toBe(false);
  });

  it('reads its instances, activation and requests in flight into tiles', async () => {
    const { wrapper } = await mountDeployment();

    const kpis = wrapper.get('[data-testid="deployment-kpis"]').text();

    expect(kpis).toContain('of 2 expected');
    expect(kpis).toContain('1 ready');
    expect(kpis).toContain('1 not running');
    expect(kpis).toContain('Always on');
    expect(kpis).toContain('Kept running by the scheduler');
    expect(kpis).toContain('3requests');
  });

  it('lists the instances with their node and follows the live instance stream', async () => {
    const { wrapper } = await mountDeployment();

    const row = wrapper.get('[data-testid="instance-row"]');

    expect(row.get('[data-testid="instance-party-link"]').attributes('href')).toBe('/nodes/3');
    expect(row.get('[data-testid="table-row-link"]').attributes('href')).toBe('/deployments/5/instance/i-1');

    const onInstances = streamDeploymentInstances.mock.calls[0][1] as (
      response: DeploymentInstancesResponseDto
    ) => void;

    onInstances(instancesResponse({ instances: [] }));
    await flushPromises();

    expect(wrapper.get('[data-testid="instances-card"]').text()).toContain('No instances are running.');
  });

  it('expands a refused node to its refusal and the figures of each card it was checked on', async () => {
    const gib = 1024 ** 3;

    getDeploymentInstances.mockResolvedValue(
      instancesResponse({
        placement: {
          nodes: [
            placementNode({
              problem: 'This deployment needs 40.0 GiB on GPU-1, more than it has free',
              capacity: {
                expectedBytes: 40 * gib,
                availableBytes: 70 * gib,
                hostFreeBytes: null,
                cards: [
                  {
                    deviceKey: 'GPU-1',
                    name: 'NVIDIA A100-SXM4-80GB',
                    totalBytes: 80 * gib,
                    usedBytes: 50 * gib,
                    predictedBytes: 0,
                    headroomBytes: 2 * gib,
                    freeBytes: 30 * gib,
                  },
                ],
                hostWeights: null,
              },
            }),
          ],
          problem: null,
        },
      })
    );

    const { wrapper } = await mountDeployment();

    const row = wrapper.get('[data-testid="placement-row"]');

    expect(row.text()).toContain('Cannot place');
    expect(row.find('[data-testid="placement-refusal"]').exists()).toBe(false);

    await row.get('button[aria-label="Show details"]').trigger('click');

    const refusal = row.get('[data-testid="placement-refusal"]');

    expect(refusal.text()).toContain('This deployment needs 40.0 GiB on GPU-1, more than it has free');

    const card = refusal.get('[data-testid="placement-card-row"]');

    expect(card.findAll('span').map(cell => cell.text())).toEqual(['80 GiB', '50 GiB', '-', '2 GiB', '30 GiB']);
    expect(card.text()).toContain('GPU-1');
    expect(card.text()).toContain('NVIDIA A100-SXM4-80GB');
  });

  it('expands a node refused without figures to its refusal alone', async () => {
    getDeploymentInstances.mockResolvedValue(
      instancesResponse({ placement: { nodes: [placementNode({ problem: 'The node is offline' })], problem: null } })
    );

    const { wrapper } = await mountDeployment();

    const row = wrapper.get('[data-testid="placement-row"]');

    await row.get('button[aria-label="Show details"]').trigger('click');

    expect(row.get('[data-testid="placement-refusal"]').text()).toBe('The node is offline');
  });

  it('opens a refused node from its name without expanding the row', async () => {
    getDeploymentInstances.mockResolvedValue(
      instancesResponse({ placement: { nodes: [placementNode({ problem: 'The node is offline' })], problem: null } })
    );

    const { wrapper, router } = await mountDeployment();

    const row = wrapper.get('[data-testid="placement-row"]');
    const link = row.get('[data-testid="placement-node-link"]');

    expect(link.attributes('href')).toBe('/nodes/3');

    await link.trigger('click');
    await flushPromises();

    expect(row.find('[data-testid="placement-refusal"]').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/nodes/3');
  });

  it('gives a node that is not refused no details to expand', async () => {
    const { wrapper } = await mountDeployment();

    expect(wrapper.get('[data-testid="placement-row"]').find('button[aria-label="Show details"]').exists()).toBe(false);
  });

  it('applies the waiting changes once confirmed', async () => {
    getDeployment.mockResolvedValue(deployment({ outOfDate: true }));

    const { wrapper } = await mountDeployment();
    const dialogStore = useDialogStore();

    expect(wrapper.text()).toContain('Changes waiting to be applied');

    await buttonNamed(wrapper, 'Apply Changes').trigger('click');

    expect(dialogStore.top?.options.title).toBe('Apply changes to llama-70b-chat?');

    await dialogStore.top?.options.action?.();
    await flushPromises();

    expect(applyDeployment).toHaveBeenCalledWith(5);
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Changes applied');
  });

  it('reports a start that every node refused as a warning', async () => {
    getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [] }));
    startDeployment.mockResolvedValue({
      started: 0,
      refused: [{ nodeId: 3, nodeName: 'gpu-a-01', problem: 'The node is offline', capacity: null }],
    });

    const { wrapper } = await mountDeployment();

    await buttonNamed(wrapper, 'Start Now').trigger('click');
    await flushPromises();

    expect(startDeployment).toHaveBeenCalledWith(5);
    expect(useNotificationStore().notifications.at(-1)?.content).toBe(
      'No instances started. These nodes could not run an instance: gpu-a-01'
    );
  });

  it('disables the deployment once confirmed', async () => {
    const { wrapper } = await mountDeployment();
    const dialogStore = useDialogStore();

    await buttonNamed(wrapper, 'Disable Deployment').trigger('click');
    await dialogStore.top?.options.action?.();

    expect(updateDeploymentState).toHaveBeenCalledWith(5, { enabled: false });
  });

  it('offers to enable a disabled deployment, leaving only deletion in the danger card', async () => {
    getDeployment.mockResolvedValue(deployment({ enabled: false }));

    const { wrapper } = await mountDeployment();

    expect(wrapper.text()).toContain('The scheduler starts nothing for this deployment');
    expect(wrapper.findAll('button').some(button => button.text() === 'Disable Deployment')).toBe(false);

    await buttonNamed(wrapper, 'Enable Deployment').trigger('click');
    await flushPromises();

    expect(updateDeploymentState).toHaveBeenCalledWith(5, { enabled: true });
  });

  it('deletes the deployment once confirmed and returns to the list', async () => {
    const { wrapper, router } = await mountDeployment();
    const dialogStore = useDialogStore();

    await buttonNamed(wrapper, 'Delete Deployment').trigger('click');
    await dialogStore.top?.options.action?.();
    await flushPromises();

    expect(deleteDeployment).toHaveBeenCalledWith(5);
    expect(router.currentRoute.value.path).toBe('/deployments');
  });
});
