import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import {
  ActivationPolicy,
  ConfigurationSource,
  ExpectedUsageSource,
  InstanceState,
  NodeState,
  PlacementProblemReason,
  ResidencyRule,
} from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';
import { useToastStore } from '@/stores/toast';

import Deployment from './Deployment.vue';

const getDeployment = vi.fn();
const getDeploymentConfiguration = vi.fn();
const restartDeployment = vi.fn();
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
    restartDeployment,
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
  onOlderSettings: false,
  restartRequested: false,
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
  problemReason: null,
  expectedUsage: null,
  measured: null,
  capacity: null,
  evictions: [],
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
    makingRoomNodeIds: [],
    restarting: false,
  },
  ...extra,
});

const mountDeployment = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/deployments', component: { template: '<div />' } },
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

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getDeployment.mockResolvedValue(deployment());
  getDeploymentConfiguration.mockResolvedValue(CONFIGURATION);
  getEventList.mockResolvedValue({ eventList: [], pages: 1 });
  getDeploymentInstances.mockResolvedValue(instancesResponse());
  restartDeployment.mockResolvedValue(undefined);
  updateDeploymentState.mockResolvedValue(undefined);
  deleteDeployment.mockResolvedValue(undefined);
  startDeployment.mockResolvedValue({ started: 1, refused: [], evicting: [] });
  stopDeployment.mockResolvedValue(undefined);
  streamEvents.mockImplementation(subscription);
  streamDeploymentInstances.mockImplementation(subscription);
});

describe('Deployment page', () => {
  it('heads the page with its name and model, linking to its settings', async () => {
    const { wrapper } = await mountDeployment();

    expect(wrapper.get('h1').text()).toBe('llama-70b-chat');
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('Llama-3.1-70B on llama.cpp');
    expect(wrapper.text()).not.toContain('Llama-3.1-70B on llama.cpp ·');
    expect(wrapper.get('a[href="/deployments/5/configuration"]').text()).toBe('Edit Settings');
    expect(wrapper.get('[data-testid="deployment-model-link"]').attributes('href')).toBe('/models/9');
  });

  it('links the preset from the settings card', async () => {
    const { wrapper } = await mountDeployment();

    const link = wrapper.get('[data-testid="deployment-preset-link"]');

    expect(link.attributes('href')).toBe('/presets/2');
    expect(link.text()).toBe('llama.cpp standard');
    expect(wrapper.text()).toContain('The values this deployment runs with.');
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('Preset: llama.cpp standard');
  });

  it('links no preset for a deployment on its own settings', async () => {
    getDeployment.mockResolvedValue(deployment({ presetId: null, presetName: null }));

    const { wrapper } = await mountDeployment();

    expect(wrapper.text()).not.toContain('its own settings');
    expect(wrapper.text()).toContain('The values this deployment runs with.');
    expect(wrapper.text()).not.toContain('Preset:');
    expect(wrapper.find('[data-testid="deployment-preset-link"]').exists()).toBe(false);
  });

  it('notices a launch backoff above the tiles only while it holds the next start back', async () => {
    const response = instancesResponse();
    const holding = { ...response.residency, launchFailures: 3, retryDate: new Date(Date.now() + 120_000) };

    getDeploymentInstances.mockResolvedValue({ ...response, residency: holding });

    const { wrapper: backingOff } = await mountDeployment();
    const retry = backingOff.get('[data-testid="launch-retry"]');

    expect(retry.text()).toContain('Last 3 starts failed');
    expect(retry.element.nextElementSibling).toBe(backingOff.get('[data-testid="deployment-kpis"]').element);
    expect(backingOff.get('[data-testid="instances-card"]').find('[role="alert"]').exists()).toBe(false);

    getDeploymentInstances.mockResolvedValue(response);

    const { wrapper: normal } = await mountDeployment();

    expect(normal.find('[data-testid="launch-retry"]').exists()).toBe(false);
    expect(normal.find('[data-testid="launch-given-up"]').exists()).toBe(false);
  });

  it('counts the backoff down every second and clears it once the wait is over', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'));

    try {
      const response = instancesResponse();
      const residency = { ...response.residency, launchFailures: 3, retryDate: new Date('2026-09-23T12:00:30Z') };

      getDeploymentInstances.mockResolvedValue({ ...response, residency });

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="launch-retry"]').text()).toContain('Retry available in 30s');

      vi.advanceTimersByTime(1000);
      await flushPromises();

      expect(wrapper.get('[data-testid="launch-retry"]').text()).toContain('Retry available in 29s');

      const onInstances = streamDeploymentInstances.mock.calls[0][1] as (next: DeploymentInstancesResponseDto) => void;

      onInstances({ ...response, residency: { ...residency, retryDate: new Date('2026-09-23T12:00:20Z') } });
      await flushPromises();

      expect(wrapper.get('[data-testid="launch-retry"]').text()).toContain('Retry available in 19s');

      vi.advanceTimersByTime(19_000);
      await flushPromises();

      expect(wrapper.find('[data-testid="launch-retry"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('notices neither a backoff nor a given-up run on a disabled deployment', async () => {
    const response = instancesResponse();
    const retryDate = new Date(Date.now() + 120_000);

    getDeployment.mockResolvedValue(deployment({ enabled: false }));
    getDeploymentInstances.mockResolvedValue({
      ...response,
      residency: { ...response.residency, launchFailures: 3, retryDate },
    });

    const { wrapper: backingOff } = await mountDeployment();

    expect(backingOff.find('[data-testid="launch-retry"]').exists()).toBe(false);

    getDeploymentInstances.mockResolvedValue({
      ...response,
      residency: { ...response.residency, launchFailures: 5, retryDate, givenUp: true },
    });

    const { wrapper: gaveUp } = await mountDeployment();

    expect(gaveUp.find('[data-testid="launch-given-up"]').exists()).toBe(false);
    expect(gaveUp.find('[data-testid="launch-retry"]').exists()).toBe(false);
  });

  it('notices a given-up deployment above the tiles in place of the backoff, with its output and a start', async () => {
    const response = instancesResponse();
    const residency = {
      ...response.residency,
      launchFailures: 5,
      retryDate: new Date(Date.now() + 120_000),
      givenUp: true,
      lastLaunchFailure: 'CUDA out of memory',
    };

    getDeploymentInstances.mockResolvedValue({ ...response, residency });

    const { wrapper } = await mountDeployment();
    const givenUp = wrapper.get('[data-testid="launch-given-up"]');

    expect(wrapper.find('[data-testid="launch-retry"]').exists()).toBe(false);
    expect(givenUp.text()).toContain('Automatic retries paused');
    expect(givenUp.text()).toContain('CUDA out of memory');
    expect(givenUp.element.nextElementSibling).toBe(wrapper.get('[data-testid="deployment-kpis"]').element);
    expect(wrapper.get('[data-testid="instances-card"]').find('[role="alert"]').exists()).toBe(false);

    expect(wrapper.findAll('button').filter(button => button.text() === 'Start Now')).toHaveLength(1);

    await givenUp.get('button').trigger('click');
    await flushPromises();

    expect(startDeployment).toHaveBeenCalledWith(5);
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

  describe('the placement table', () => {
    const gib = 1024 ** 3;

    const CARD = {
      deviceKey: 'GPU-1',
      name: 'NVIDIA A100-SXM4-80GB',
      totalBytes: 80 * gib,
      usedBytes: 50 * gib,
      predictedBytes: 0,
      headroomBytes: 2 * gib,
      freeBytes: 30 * gib,
      short: true,
    };

    const USAGE = {
      bytes: 40 * gib,
      source: ExpectedUsageSource.DECLARED,
      hostWeightsBytes: 30 * gib,
      hostResidentBytes: 30 * gib,
      hostCacheBytes: 8 * gib,
    };

    const mountRow = async (extra: Partial<PlacementNodeDto>) => {
      getDeploymentInstances.mockResolvedValue(
        instancesResponse({ placement: { nodes: [placementNode(extra)], problem: null } })
      );

      const { wrapper } = await mountDeployment();

      return { wrapper, row: wrapper.get('[data-testid="placement-row"]') };
    };

    it('heads the columns Node, VRAM, RAM and Status', async () => {
      const { wrapper } = await mountRow({});
      const text = wrapper.get('[data-testid="placement-card"]').text();

      expect(text).toContain('NodeVRAMRAMStatus');
      expect(text).not.toContain('Kept off the GPUs');
      expect(text).not.toContain('System memory');
    });

    it('reads needed against free in each cell, turning the short one red with hovers for source and parts', async () => {
      const { row } = await mountRow({
        problem: 'Not enough RAM for 30.0 GiB of model weights and up to 8.0 GiB of prompt cache',
        problemReason: PlacementProblemReason.NOT_ENOUGH_RAM,
        expectedUsage: USAGE,
        capacity: {
          expectedBytes: 40 * gib,
          availableBytes: 70 * gib,
          hostFreeBytes: null,
          cards: [],
          hostWeights: { neededBytes: 38 * gib, cacheBytes: 8 * gib, freeBytes: 12 * gib },
        },
      });

      const vram = row.get('[data-testid="placement-vram"]');
      const ram = row.get('[data-testid="placement-ram"]');

      expect(vram.text()).toBe('40 / 70 GiB free');
      expect(vram.classes()).not.toContain('text-error');
      expect(vram.get('[title]').attributes('title')).toBe('Declared');
      expect(ram.text()).toBe('38 / 12 GiB free');
      expect(ram.classes()).toContain('text-error');
      expect(ram.get('[title]').attributes('title')).toBe('CPU pinned 30 GiB · Prompt cache ≤8 GiB');
      expect(row.text()).not.toContain('Declared');
    });

    it('moves the refusal to a hover on the status, marking the short card in the expansion', async () => {
      const { row } = await mountRow({
        problem: 'Not enough memory on GPU-1 for 40.0 GiB',
        problemReason: PlacementProblemReason.NOT_ENOUGH_VRAM,
        capacity: {
          expectedBytes: 40 * gib,
          availableBytes: 70 * gib,
          hostFreeBytes: null,
          cards: [CARD],
          hostWeights: null,
        },
      });

      const status = row.get('[data-testid="placement-status"]');

      expect(status.text()).toBe('Not enough VRAM');
      expect(status.attributes('title')).toBe('Not enough memory on GPU-1 for 40.0 GiB');
      expect(row.get('[data-testid="placement-vram"]').classes()).toContain('text-error');
      expect(row.find('[data-testid="placement-refusal"]').exists()).toBe(false);

      await row.get('button[aria-label="Show details"]').trigger('click');

      const refusal = row.get('[data-testid="placement-refusal"]');

      expect(refusal.text()).not.toContain('Not enough memory on GPU-1 for 40.0 GiB');

      const card = refusal.get('[data-testid="placement-card-row"]');

      expect(card.findAll('span').map(cell => cell.text())).toEqual(['80 GiB', '50 GiB', '-', '2 GiB', '30 GiB']);
      expect(card.text()).toContain('GPU-1');
      expect(card.text()).toContain('NVIDIA A100-SXM4-80GB');
      expect(card.classes()).toContain('text-error');
    });

    it('leaves a card that is not short its usual colour', async () => {
      const { row } = await mountRow({
        problem: 'Not enough GPU memory for 40.0 GiB',
        problemReason: PlacementProblemReason.NOT_ENOUGH_VRAM,
        capacity: {
          expectedBytes: 40 * gib,
          availableBytes: 20 * gib,
          hostFreeBytes: null,
          cards: [{ ...CARD, short: false }],
          hostWeights: null,
        },
      });

      await row.get('button[aria-label="Show details"]').trigger('click');

      expect(row.get('[data-testid="placement-card-row"]').classes()).not.toContain('text-error');
    });

    it('offers no expansion for a refusal without figures, its reason on the status alone', async () => {
      const { row } = await mountRow({ problem: 'The node is offline', problemReason: PlacementProblemReason.OTHER });

      const status = row.get('[data-testid="placement-status"]');

      expect(status.text()).toBe('Cannot run here');
      expect(status.attributes('title')).toBe('The node is offline');
      expect(row.find('button[aria-label="Show details"]').exists()).toBe(false);
    });
  });

  it('opens a refused node from its name without expanding the row', async () => {
    getDeploymentInstances.mockResolvedValue(
      instancesResponse({
        placement: {
          nodes: [placementNode({ problem: 'The node is offline', problemReason: PlacementProblemReason.OTHER })],
          problem: null,
        },
      })
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

  describe('instances on older settings', () => {
    it('hides the notice when all instances use the latest settings', async () => {
      const { wrapper } = await mountDeployment();

      expect(wrapper.find('[data-testid="older-settings"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="instance-older-settings"]').exists()).toBe(false);
    });

    it('tags instances on older settings and requests a restart after confirmation', async () => {
      getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [instance({ onOlderSettings: true })] }));

      const { wrapper } = await mountDeployment();
      const dialogStore = useDialogStore();

      expect(wrapper.get('[data-testid="older-settings"]').text()).toContain('The configuration has changed');
      expect(wrapper.get('[data-testid="older-settings"]').text()).toContain('1 instance on older settings');
      expect(wrapper.get('[data-testid="instance-older-settings"]').text()).toBe('Older settings');

      await buttonNamed(wrapper, 'Restart').trigger('click');

      expect(dialogStore.top?.options.title).toBe('Restart instances of llama-70b-chat?');

      await dialogStore.top?.options.action?.();
      await flushPromises();

      expect(restartDeployment).toHaveBeenCalledWith(5);
      expect(useToastStore().toasts.at(-1)?.title).toBe('Restart requested');
    });

    it('shows pending restart status without another restart button', async () => {
      getDeploymentInstances.mockResolvedValue(
        instancesResponse({ instances: [instance({ onOlderSettings: true, restartRequested: true })] })
      );

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="restart-progress"]').text()).toContain('Restart in progress');
      expect(wrapper.find('[data-testid="older-settings"]').exists()).toBe(false);
    });

    it('offers restart when an instance has no pending request', async () => {
      getDeploymentInstances.mockResolvedValue(
        instancesResponse({
          instances: [
            instance({ onOlderSettings: true, restartRequested: true }),
            instance({ instanceKey: 'i-2', onOlderSettings: true }),
          ],
        })
      );

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="restart-progress"]').text()).toContain('Restart in progress');
      expect(buttonNamed(wrapper, 'Restart').exists()).toBe(true);
    });

    it('shows restart status while the replacement waits for memory', async () => {
      getDeploymentInstances.mockResolvedValue(
        instancesResponse({ residency: { ...instancesResponse().residency, restarting: true } })
      );

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="restart-progress"]').text()).toContain('Restart in progress');
    });

    it('shows both notices when some instances still need a restart request', async () => {
      getDeploymentInstances.mockResolvedValue(
        instancesResponse({
          instances: [
            instance({ onOlderSettings: true, restartRequested: true }),
            instance({ instanceKey: 'i-2', onOlderSettings: true }),
          ],
          residency: { ...instancesResponse().residency, restarting: true },
        })
      );

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="older-settings"]').text()).toContain('1 instance on older settings');
      expect(wrapper.get('[data-testid="restart-progress"]').text()).toContain('Restart in progress');
      expect(buttonNamed(wrapper, 'Restart').exists()).toBe(true);
    });
  });

  describe('starting over idle instances', () => {
    const EVICTION = {
      deploymentName: 'qwen-idle',
      instanceKey: 'key-1',
      devices: [{ deviceKey: 'GPU-a', name: null }],
      idleMs: 300_000,
      releasedBytes: 8 * 1024 ** 3,
    };

    const evictingResponse = () =>
      instancesResponse({
        instances: [],
        placement: { nodes: [placementNode({ evictions: [EVICTION] })], problem: null },
      });

    it('asks first, naming what goes, and only then says the operator confirmed', async () => {
      getDeploymentInstances.mockResolvedValue(evictingResponse());
      startDeployment.mockResolvedValue({ started: 0, refused: [], evicting: [EVICTION] });

      const { wrapper } = await mountDeployment();
      const dialogStore = useDialogStore();

      await buttonNamed(wrapper, 'Start Now').trigger('click');
      await flushPromises();

      expect(dialogStore.top?.options.title).toBe('Stop instances to free memory?');
      expect(dialogStore.top?.options.message).toBe(
        'This deployment needs more memory to start. ' +
          'Instances of these deployments will stop to free memory: qwen-idle'
      );
      expect(startDeployment).not.toHaveBeenCalled();

      await dialogStore.top?.options.action?.();
      await flushPromises();

      expect(startDeployment).toHaveBeenCalledWith(5, null, true);
    });

    it('says it is making room rather than refused', async () => {
      const response = instancesResponse({
        instances: [],
        placement: { nodes: [placementNode({ evictions: [EVICTION] })], problem: 'Not yet' },
      });

      getDeploymentInstances.mockResolvedValue({
        ...response,
        residency: { ...response.residency, makingRoomNodeIds: [placementNode().nodeId] },
      });

      const { wrapper } = await mountDeployment();

      expect(wrapper.get('[data-testid="making-room"]').text()).toContain('Making room for this deployment');
      expect(wrapper.text()).not.toContain('Unable to start');
    });

    it('starts at once with no confirmation where nothing would be evicted', async () => {
      getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [] }));

      const { wrapper } = await mountDeployment();

      await buttonNamed(wrapper, 'Start Now').trigger('click');
      await flushPromises();

      expect(startDeployment).toHaveBeenCalledWith(5);
      expect(useDialogStore().top).toBeNull();
    });
  });

  it('reports a start that every node refused as a warning', async () => {
    getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [] }));
    startDeployment.mockResolvedValue({
      started: 0,
      refused: [{ nodeId: 3, nodeName: 'gpu-a-01', problem: 'The node is offline', capacity: null }],
      evicting: [],
    });

    const { wrapper } = await mountDeployment();

    await buttonNamed(wrapper, 'Start Now').trigger('click');
    await flushPromises();

    expect(startDeployment).toHaveBeenCalledWith(5);
    expect(useNotificationStore().notifications.at(-1)?.content).toBe(
      'No instances started. Could not start on: gpu-a-01'
    );
  });

  it('says so where a start finds nothing to do, naming no nodes', async () => {
    getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [] }));
    startDeployment.mockResolvedValue({ started: 0, refused: [], evicting: [] });

    const { wrapper } = await mountDeployment();

    await buttonNamed(wrapper, 'Start Now').trigger('click');
    await flushPromises();

    expect(useToastStore().toasts.at(-1)?.title).toBe('Nothing to start');
  });

  it('reports a refused node alongside the room being made on another', async () => {
    getDeploymentInstances.mockResolvedValue(instancesResponse({ instances: [] }));
    startDeployment.mockResolvedValue({
      started: 0,
      refused: [{ nodeId: 3, nodeName: 'gpu-a-01', problem: 'The node is offline', capacity: null }],
      evicting: [
        {
          deploymentName: 'qwen-idle',
          instanceKey: 'key-1',
          devices: [{ deviceKey: 'GPU-a', name: null }],
          idleMs: 300_000,
          releasedBytes: 8 * 1024 ** 3,
        },
      ],
    });

    const { wrapper } = await mountDeployment();

    await buttonNamed(wrapper, 'Start Now').trigger('click');
    await flushPromises();

    expect(useToastStore().toasts.map(toast => toast.title)).toEqual(['Making room']);
    expect(useNotificationStore().notifications.at(-1)?.content).toBe(
      'No instances started. Could not start on: gpu-a-01'
    );
  });

  it('disables the deployment once confirmed', async () => {
    const { wrapper } = await mountDeployment();
    const dialogStore = useDialogStore();

    await buttonNamed(wrapper, 'Disable Deployment').trigger('click');
    await dialogStore.top?.options.action?.();

    expect(updateDeploymentState).toHaveBeenCalledWith(5, { enabled: false });
  });

  it('drops the given-up notice once the deployment is disabled, whatever the residency still says', async () => {
    const response = instancesResponse();

    getDeploymentInstances.mockResolvedValue({
      ...response,
      residency: { ...response.residency, launchFailures: 5, givenUp: true },
    });

    const { wrapper } = await mountDeployment();
    const dialogStore = useDialogStore();

    expect(wrapper.find('[data-testid="launch-given-up"]').exists()).toBe(true);

    getDeployment.mockResolvedValue(deployment({ enabled: false }));

    await buttonNamed(wrapper, 'Disable Deployment').trigger('click');
    await dialogStore.top?.options.action?.();
    await flushPromises();

    expect(wrapper.find('[data-testid="launch-given-up"]').exists()).toBe(false);
  });

  it('offers to enable a disabled deployment, leaving only deletion in the danger card', async () => {
    getDeployment.mockResolvedValue(deployment({ enabled: false }));

    const { wrapper } = await mountDeployment();

    expect(wrapper.text()).toContain('Enable this deployment to start instances and accept requests.');
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

  it('scrolls the event log above its pages and opens each new page at its first row', async () => {
    getEventList.mockResolvedValue({ eventList: [], pages: 2 });

    const { wrapper } = await mountDeployment();

    const card = wrapper.get('[data-testid="event-log-card"]');
    const region = card.get('[role="region"]');

    expect(region.attributes('aria-label')).toBe('Event log');
    expect(region.find('nav[aria-label="Pagination"]').exists()).toBe(false);
    expect(card.find('nav[aria-label="Pagination"]').exists()).toBe(true);

    region.element.scrollTop = 200;

    await card.get('button[aria-label="Page 2"]').trigger('click');
    await flushPromises();

    expect(getEventList).toHaveBeenLastCalledWith(expect.anything(), 2);
    expect(card.get('[role="region"]').element.scrollTop).toBe(0);
  });
});
