import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { GpuTelemetryDto, ListInstanceDto, NodeDto, NodeModelDto, NodeTelemetryStatusDto } from '@libs/dto';
import {
  GpuProcessAttribution,
  GpuVendor,
  InstanceState,
  ModelFormat,
  ModelType,
  NodeState,
  NodeTelemetryState,
} from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Node from './Node.vue';

const GIB = 1024 ** 3;

const getNode = vi.fn();
const updateNode = vi.fn();
const updateState = vi.fn();
const deleteNode = vi.fn();
const getEventList = vi.fn();
const streamEvents = vi.fn();
const getNodeModelInventory = vi.fn();
const scanNodeModels = vi.fn();
const getNodeTelemetryStatus = vi.fn();
const streamNodeTelemetryStatus = vi.fn();
const getNodeInstances = vi.fn();
const streamNodeInstances = vi.fn();

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNode, updateNode, updateState, deleteNode }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ getEventList, streamEvents }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getNodeModelInventory, scanNodeModels }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getNodeTelemetryStatus, streamNodeTelemetryStatus }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ getNodeInstances, streamNodeInstances }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const node = (extra: Partial<NodeDto> = {}): NodeDto => ({
  id: 3,
  name: 'gpu-a-01',
  state: NodeState.ONLINE,
  enabled: true,
  lastSeenDate: new Date(),
  agentVersion: '0.9.4',
  nodeKey: '9a23f28d-f575-4f39-b4a1-697da34ffcf4',
  description: 'Rack 4, DC1',
  createdDate: new Date('2026-02-04T12:00:00.000Z'),
  ...extra,
});

const device: GpuTelemetryDto = {
  deviceKey: 'GPU-4f2c',
  vendor: GpuVendor.NVIDIA,
  name: 'NVIDIA A100-SXM4-80GB',
  pciBusId: null,
  memoryTotalBytes: 80 * GIB,
  lastReportedDate: new Date(),
  index: 0,
  memoryUsedBytes: 40 * GIB,
  utilisationPercent: 90,
  temperatureC: 70,
  powerDrawWatts: 380,
  processAttribution: GpuProcessAttribution.EXACT,
  processes: [
    {
      pid: 1,
      usedBytes: 40 * GIB,
      name: 'llama-server',
      containerId: null,
      containerName: null,
      instanceKey: 'instance-a',
      deploymentName: 'llama-70b-chat',
    },
  ],
  predictions: [],
};

const status = (extra: Partial<NodeTelemetryStatusDto> = {}): NodeTelemetryStatusDto => ({
  telemetryState: NodeTelemetryState.OK,
  capturedAt: new Date(),
  receivedAt: new Date(),
  host: {
    cpuModel: 'AMD EPYC 7763',
    cpuCount: 64,
    loadAverage1m: 4.12,
    memoryTotalBytes: 512 * GIB,
    memoryFreeBytes: 384 * GIB,
    modelDirectories: [],
  },
  devices: [device],
  errors: [],
  headroomBytes: 2 * GIB,
  ...extra,
});

const instance: ListInstanceDto = {
  instanceKey: 'instance-a',
  deploymentId: 4,
  deploymentName: 'llama-70b-chat',
  nodeId: 3,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [{ deviceKey: 'GPU-4f2c', name: 'NVIDIA A100-SXM4-80GB' }],
  state: InstanceState.READY,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
};

const nodeModel: NodeModelDto = {
  id: 9,
  name: 'Llama-3.1-70B-Instruct-Q4_K_M.gguf',
  displayName: null,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  quantisation: 'Q4_K_M',
  quantisationMixed: false,
  sizeBytes: 40 * GIB,
  path: '/srv/weights/llama.gguf',
  lastConfirmedDate: new Date(),
};

const mountNode = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/nodes/:nodeId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/nodes/3');

  const wrapper = mount(Node, { global: { plugins: [router] } });
  await flushPromises();

  return { wrapper, router };
};

const buttonNamed = (wrapper: Awaited<ReturnType<typeof mountNode>>['wrapper'], label: string) => {
  const button = wrapper.findAll('button').find(candidate => candidate.text() === label);

  if (button === undefined) {
    throw new Error(`No button named ${label}`);
  }

  return button;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  getNode.mockResolvedValue(node());
  getEventList.mockResolvedValue({ eventList: [], pages: 1 });
  getNodeModelInventory.mockResolvedValue({ models: [nodeModel] });
  getNodeTelemetryStatus.mockResolvedValue(status());
  getNodeInstances.mockResolvedValue({ instances: [instance] });
  updateState.mockResolvedValue(undefined);
  deleteNode.mockResolvedValue(undefined);
  scanNodeModels.mockResolvedValue(undefined);
  streamEvents.mockImplementation(subscription);
  streamNodeTelemetryStatus.mockImplementation(subscription);
  streamNodeInstances.mockImplementation(subscription);
});

describe('Node page', () => {
  it("heads the page with the node's name and description, over its details with its state", async () => {
    const { wrapper } = await mountNode();

    expect(wrapper.get('h1').text()).toBe('gpu-a-01');
    expect(wrapper.get('[data-testid="node-state"]').text()).toBe('Online');
    expect(wrapper.text()).toContain('Rack 4, DC1');
    expect(wrapper.text()).toContain(node().nodeKey);
    expect(wrapper.text()).toContain('1 × NVIDIA A100-SXM4-80GB');
    expect(wrapper.text()).toContain('0.9.4');
  });

  it("reads the host's CPU, memory and load into tiles", async () => {
    const { wrapper } = await mountNode();

    const kpis = wrapper.get('[data-testid="host-kpis"]').text();

    expect(kpis).toContain('64');
    expect(kpis).toContain('AMD EPYC 7763');
    expect(kpis).toContain('128 GiB');
    expect(kpis).toContain('25% used');
    expect(kpis).toContain('4.12');
    expect(kpis).toContain('About 6% of 64 cores');
  });

  it('lists each GPU, and the instances on the node with the memory each holds', async () => {
    const { wrapper } = await mountNode();

    expect(wrapper.get('[data-testid="gpus-card"]').text()).toContain('GPU 0 · NVIDIA A100-SXM4-80GB');

    const instanceRow = wrapper.get('[data-testid="instance-row"]');

    expect(instanceRow.text()).toContain('40 GiB');
    expect(instanceRow.get('[data-testid="instance-party-link"]').attributes('href')).toBe('/deployments/4');
    expect(instanceRow.get('[data-testid="table-row-link"]').attributes('href')).toBe(
      '/deployments/4/instance/instance-a'
    );
  });

  it('tells a node that never reported from one that has no GPUs', async () => {
    getNodeTelemetryStatus.mockResolvedValue(status({ telemetryState: null, host: null, devices: [] }));
    getNode.mockResolvedValue(node({ state: NodeState.REGISTERED, lastSeenDate: null }));

    const { wrapper } = await mountNode();

    expect(wrapper.text()).toContain('Awaiting first contact');
    expect(wrapper.find('[data-testid="host-kpis"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="gpus-card"]').text()).toContain('This node has not reported its devices yet.');

    const onStatus = streamNodeTelemetryStatus.mock.calls[0][1] as (update: NodeTelemetryStatusDto) => void;

    onStatus(status({ devices: [] }));
    await flushPromises();

    expect(wrapper.get('[data-testid="gpus-card"]').text()).toContain(
      'This node has no GPUs. It will run CPU-only workloads.'
    );
  });

  it('lists the models the node holds, linking to each, and asks it to rescan', async () => {
    const { wrapper } = await mountNode();

    const modelRow = wrapper.get('[data-testid="model-row"]');

    expect(modelRow.text()).toContain('Llama-3.1-70B-Instruct-Q4_K_M.gguf');
    expect(modelRow.text()).toContain('GGUF Q4_K_M');
    expect(modelRow.get('[data-testid="table-row-link"]').attributes('href')).toBe('/models/9');

    await buttonNamed(wrapper, 'Rescan').trigger('click');
    await flushPromises();

    expect(scanNodeModels).toHaveBeenCalledWith(3);
    expect(useNotificationStore().notifications.at(-1)?.title).toBe('Rescan started');
  });

  it('disables the node once confirmed', async () => {
    const { wrapper } = await mountNode();
    const dialogStore = useDialogStore();

    await buttonNamed(wrapper, 'Disable Node').trigger('click');

    const dialog = dialogStore.top;

    expect(dialog?.options.title).toBe('Disable gpu-a-01?');

    await dialog?.options.action?.();

    expect(updateState).toHaveBeenCalledWith({ enabled: false }, 3);
  });

  it('offers to enable a disabled node, leaving only deletion in the danger card', async () => {
    getNode.mockResolvedValue(node({ enabled: false, state: NodeState.DISABLED }));

    const { wrapper } = await mountNode();

    expect(wrapper.findAll('button').some(button => button.text() === 'Disable Node')).toBe(false);

    await buttonNamed(wrapper, 'Enable Node').trigger('click');
    await flushPromises();

    expect(updateState).toHaveBeenCalledWith({ enabled: true }, 3);
  });

  it('deletes the node once confirmed and returns to the list', async () => {
    const { wrapper, router } = await mountNode();
    const dialogStore = useDialogStore();

    await buttonNamed(wrapper, 'Delete Node').trigger('click');
    await dialogStore.top?.options.action?.();
    await flushPromises();

    expect(deleteNode).toHaveBeenCalledWith(3);
    expect(router.currentRoute.value.path).toBe('/nodes');
  });
});
