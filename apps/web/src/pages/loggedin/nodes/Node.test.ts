import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type {
  EventDto,
  GpuTelemetryDto,
  InstanceMemoryDto,
  ListInstanceDto,
  NodeDto,
  NodeHostTelemetryDto,
  NodeModelDto,
  NodeTelemetryStatusDto,
} from '@libs/dto';
import {
  EventPartyType,
  EventType,
  GpuProcessAttribution,
  GpuVendor,
  InstanceState,
  ModelFormat,
  ModelType,
  NodeState,
  NodeTelemetryState,
} from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useToastStore } from '@/stores/toast';

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
    heldByModelsBytes: 96 * GIB,
    heldByModelsUnknown: false,
    memoryAvailableBytes: 288 * GIB,
    instanceMemory: [],
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
  onOlderSettings: false,
  restartRequested: false,
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

const modelsNumbered = (count: number): NodeModelDto[] =>
  Array.from({ length: count }, (_, index) => ({ ...nodeModel, id: index + 1 }));

const mountNode = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/nodes', component: { template: '<div />' } },
      { path: '/nodes/:nodeId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/nodes/3');

  const wrapper = mount(Node, { global: { plugins: [router] } });
  await flushPromises();

  return { wrapper, router };
};

type MemoryReading = Omit<InstanceMemoryDto, 'residentBytes'> & Partial<Pick<InstanceMemoryDto, 'residentBytes'>>;

const heldBy = (instanceMemory: MemoryReading[], extra: Partial<NodeHostTelemetryDto> = {}): NodeTelemetryStatusDto =>
  status({
    host: {
      ...status().host!,
      instanceMemory: instanceMemory.map(reading => ({
        ...reading,
        residentBytes: reading.residentBytes === undefined ? reading.heldBytes : reading.residentBytes,
      })),
      ...extra,
    },
  });

type NodeWrapper = Awaited<ReturnType<typeof mountNode>>['wrapper'];

const memoryTile = (wrapper: NodeWrapper) => wrapper.get('[data-testid="host-kpis"]').findAll('.flex.h-full')[1];

const memoryDetail = (wrapper: NodeWrapper) => memoryTile(wrapper).get('[data-testid="kpi-detail"]').text();

const cpuTile = (wrapper: NodeWrapper) => wrapper.get('[data-testid="host-kpis"]').findAll('.flex.h-full')[0];

const storageTile = (wrapper: NodeWrapper) => wrapper.get('[data-testid="host-kpis"]').findAll('.flex.h-full')[2];

type TileWrapper = ReturnType<typeof memoryTile>;

const legendOf = (tile: TileWrapper) =>
  tile.findAll('[data-testid="meter-legend"] > span').map(item =>
    item
      .findAll('span')
      .slice(1)
      .map(part => part.text())
      .join(' ')
  );

const bandsOf = (tile: TileWrapper) => tile.get('.h-2').findAll('div');

const memoryLegend = (wrapper: NodeWrapper) => legendOf(memoryTile(wrapper));

const memoryBands = (wrapper: NodeWrapper) => bandsOf(memoryTile(wrapper));

const widths = (bands: ReturnType<typeof bandsOf>) => bands.map(band => band.attributes('style'));

const stored = (modelDirectories: NodeHostTelemetryDto['modelDirectories']): NodeTelemetryStatusDto =>
  status({ host: { ...status().host!, modelDirectories } });

const folder = (path: string, freeBytes: number | null, totalBytes: number | null) => ({
  path,
  freeBytes,
  totalBytes,
  writeAccess: null,
});

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
    expect(wrapper.text()).toContain('0.9.4');
  });

  it("reads the host's CPU and memory into tiles", async () => {
    getNodeTelemetryStatus.mockResolvedValue(heldBy([{ instanceKey: 'instance-a', heldBytes: 96 * GIB }]));

    const { wrapper } = await mountNode();

    const kpis = wrapper.get('[data-testid="host-kpis"]').text();

    expect(kpis).toContain('224 GiB');
    expect(kpis).toContain('of 512 GiB');
    expect(memoryDetail(wrapper)).toBe('288 GiB free');
    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 96 GiB', 'Other 128 GiB']);
    expect(kpis).not.toContain('available');
    expect(kpis).not.toContain('held by models');
  });

  it('reads load into the CPU tile, keyed by its cores and model with no dot', async () => {
    const { wrapper } = await mountNode();

    const tile = cpuTile(wrapper);

    expect(tile.get('[data-testid="kpi-value"]').text()).toContain('4.12');
    expect(tile.get('[data-testid="kpi-value"]').text()).toContain('1-minute average');
    expect(tile.get('[data-testid="kpi-bands"]').findAll('div')[0].attributes('style')).toBe('flex-grow: 6;');
    expect(tile.get('[data-testid="kpi-bands"]').findAll('div')[0].classes()).toContain('bg-success');
    expect(tile.findAll('.whitespace-nowrap').map(item => item.text())).toEqual(['64 cores', 'AMD EPYC 7763']);
    expect(tile.find('.rounded-full').exists()).toBe(false);
    expect(tile.text()).not.toContain('About');
  });

  it('warns on the CPU bar as load nears the core count', async () => {
    getNodeTelemetryStatus.mockResolvedValue(heldBy([], { loadAverage1m: 64 }));

    const { wrapper } = await mountNode();

    expect(cpuTile(wrapper).get('[data-testid="kpi-bands"]').findAll('div')[0].classes()).toContain('bg-error');
  });

  it.each([
    { name: 'one core', extra: { cpuCount: 1, loadAverage1m: 0.5 }, value: '0.50', key: ['1 core', 'AMD EPYC 7763'] },
    { name: 'no model', extra: { cpuModel: null }, value: '4.12', key: ['64 cores'] },
    { name: 'no cores', extra: { cpuCount: 0 }, value: '-', key: ['Cores not reported', 'AMD EPYC 7763'] },
    { name: 'neither', extra: { cpuCount: 0, cpuModel: null }, value: '-', key: ['Cores not reported'] },
    { name: 'no load', extra: { loadAverage1m: null }, value: '-', key: ['64 cores', 'AMD EPYC 7763'] },
  ])('keys the CPU tile for $name', async ({ extra, value, key }) => {
    getNodeTelemetryStatus.mockResolvedValue(heldBy([], extra));

    const { wrapper } = await mountNode();

    const tile = cpuTile(wrapper);

    expect(tile.get('[data-testid="kpi-value"] span').text()).toBe(value);
    expect(tile.find('[data-testid="kpi-bands"]').exists()).toBe(value !== '-');
    expect(tile.findAll('.whitespace-nowrap').map(item => item.text())).toEqual(key);
  });

  it('reads two model folders into the storage tile, one band each of the combined total', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      stored([folder('/srv/models', 140 * GIB, 300 * GIB), folder('/mnt/nvme', 60 * GIB, 100 * GIB)])
    );

    const { wrapper } = await mountNode();

    const tile = storageTile(wrapper);
    const bands = bandsOf(tile);

    expect(tile.text()).toContain('Model storage');
    expect(tile.get('[data-testid="kpi-value"] span').text()).toBe('200 GiB');
    expect(tile.get('[data-testid="kpi-value"]').text()).toContain('of 400 GiB');
    expect(tile.get('[data-testid="kpi-detail"]').text()).toBe('200 GiB free');
    expect(legendOf(tile)).toEqual(['/srv/models 160 GiB', '/mnt/nvme 40 GiB']);
    expect(widths(bands)).toEqual(['width: 40%;', 'width: 10%;']);
    expect(bands[0].classes()).toContain('bg-series-1');
    expect(bands[1].classes()).toContain('bg-series-2');
  });

  it('counts folders with the same free and total once, under the first path', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      stored([
        folder('/srv/models', 60 * GIB, 100 * GIB),
        folder('/srv/models-extra', 60 * GIB, 100 * GIB),
        folder('/mnt/nvme', 60 * GIB, 300 * GIB),
      ])
    );

    const { wrapper } = await mountNode();

    const tile = storageTile(wrapper);

    expect(tile.get('[data-testid="kpi-value"]').text()).toContain('of 400 GiB');
    expect(legendOf(tile)).toEqual(['/srv/models 40 GiB', '/mnt/nvme 240 GiB']);
  });

  it('keys an unreadable folder as Unknown on an empty band, reading free as a floor', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      stored([folder('/srv/models', 60 * GIB, 100 * GIB), folder('/mnt/lost', null, null)])
    );

    const { wrapper } = await mountNode();

    const tile = storageTile(wrapper);

    expect(tile.get('[data-testid="kpi-detail"]').text()).toBe('At least 60 GiB free');
    expect(legendOf(tile)).toEqual(['/srv/models 40 GiB', '/mnt/lost Unknown']);
    expect(widths(bandsOf(tile))).toEqual(['width: 40%;', 'width: 0%;']);
  });

  it.each([
    { name: 'no folders', modelDirectories: [] },
    { name: 'no readable folders', modelDirectories: [folder('/mnt/lost', null, 100 * GIB)] },
  ])('reads the storage tile as not reported with $name', async ({ modelDirectories }) => {
    getNodeTelemetryStatus.mockResolvedValue(stored(modelDirectories));

    const { wrapper } = await mountNode();

    const tile = storageTile(wrapper);

    expect(tile.get('[data-testid="kpi-value"] span').text()).toBe('-');
    expect(tile.find('[data-testid="kpi-meter"]').exists()).toBe(false);
    expect(tile.find('[data-testid="kpi-detail"]').exists()).toBe(false);
    expect(tile.get('.whitespace-nowrap').text()).toBe('Not reported');
  });

  it('gives each deployment one band after a neutral used band, grouping its instances', async () => {
    getNodeInstances.mockResolvedValue({
      instances: [
        instance,
        { ...instance, instanceKey: 'instance-b' },
        { ...instance, instanceKey: 'instance-c', deploymentName: 'qwen-coder' },
      ],
    });
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([
        { instanceKey: 'instance-a', heldBytes: 32 * GIB },
        { instanceKey: 'instance-b', heldBytes: 32 * GIB },
        { instanceKey: 'instance-c', heldBytes: 32 * GIB },
      ])
    );

    const { wrapper } = await mountNode();

    const bands = memoryBands(wrapper);

    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 64 GiB', 'qwen-coder 32 GiB', 'Other 128 GiB']);
    expect(widths(bands)).toEqual(['width: 12.5%;', 'width: 6.25%;', 'width: 25%;']);
    expect(bands[0].classes()).toContain('bg-series-1');
    expect(bands[1].classes()).toContain('bg-series-2');
    expect(bands[2].classes()).toContain('bg-muted');
    expect(bands[2].attributes('title')).toBe('Other · 128 GiB');
  });

  it('keys an unread instance as Unknown on an empty band, reading free as a ceiling', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([{ instanceKey: 'instance-a', heldBytes: null }], { heldByModelsBytes: 0, heldByModelsUnknown: true })
    );

    const { wrapper } = await mountNode();

    expect(memoryDetail(wrapper)).toBe('At most 288 GiB free');
    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat Unknown', 'Other 128 GiB']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 0%;', 'width: 25%;']);
  });

  it('counts an instance with no row in the list as other', async () => {
    getNodeTelemetryStatus.mockResolvedValue(heldBy([{ instanceKey: 'instance-gone', heldBytes: 96 * GIB }]));

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['Other 224 GiB']);
    expect(memoryBands(wrapper)[0].classes()).toContain('bg-muted');
  });

  it('keys an unread instance with no row in the list as models', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([{ instanceKey: 'instance-gone', heldBytes: null }], { heldByModelsBytes: 0, heldByModelsUnknown: true })
    );

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['Models Unknown', 'Other 128 GiB']);
  });

  it("moves a deployment's anonymous memory out of Other, the bands summing to the headline", async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([{ instanceKey: 'instance-a', heldBytes: 2 * GIB, residentBytes: 102 * GIB }], {
        heldByModelsBytes: 2 * GIB,
        memoryAvailableBytes: 382 * GIB,
      })
    );

    const { wrapper } = await mountNode();

    expect(memoryTile(wrapper).get('[data-testid="kpi-value"]').text()).toContain('130 GiB');
    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 102 GiB', 'Other 28 GiB']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 19.921875%;', 'width: 5.46875%;']);
  });

  it("leaves an unmatched instance's anonymous memory inside Other, adding only its mapped pages", async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([{ instanceKey: 'instance-gone', heldBytes: 2 * GIB, residentBytes: 102 * GIB }], {
        heldByModelsBytes: 2 * GIB,
        memoryAvailableBytes: 382 * GIB,
      })
    );

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['Other 130 GiB']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 25.390625%;']);
  });

  it('shrinks only the mapped part of a deployment where double-counted pages pass the free figure', async () => {
    getNodeInstances.mockResolvedValue({
      instances: [instance, { ...instance, instanceKey: 'instance-b', deploymentName: 'qwen-coder' }],
    });
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy(
        [
          { instanceKey: 'instance-a', heldBytes: 384 * GIB, residentBytes: 448 * GIB },
          { instanceKey: 'instance-b', heldBytes: 384 * GIB },
        ],
        { heldByModelsBytes: 768 * GIB, memoryAvailableBytes: 0 }
      )
    );

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 448 GiB', 'qwen-coder 384 GiB', 'Other 64 GiB']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 50%;', 'width: 37.5%;', 'width: 12.5%;']);
  });

  it('floors Other at zero and keeps the bands on the headline where anonymous memory passes used', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([{ instanceKey: 'instance-a', heldBytes: 0, residentBytes: 256 * GIB }], { heldByModelsBytes: 0 })
    );

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 256 GiB', 'Other 0 B']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 25%;', 'width: 0%;']);
  });

  it('keeps the bands within the bar with no overflow marker, the legend reading each figure in full', async () => {
    getNodeInstances.mockResolvedValue({
      instances: [instance, { ...instance, instanceKey: 'instance-b', deploymentName: 'qwen-coder' }],
    });
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy(
        [
          { instanceKey: 'instance-a', heldBytes: 384 * GIB },
          { instanceKey: 'instance-b', heldBytes: 384 * GIB },
        ],
        { heldByModelsBytes: 768 * GIB, memoryAvailableBytes: 0 }
      )
    );

    const { wrapper } = await mountNode();

    expect(memoryLegend(wrapper)).toEqual(['llama-70b-chat 384 GiB', 'qwen-coder 384 GiB', 'Other 128 GiB']);
    expect(widths(memoryBands(wrapper))).toEqual(['width: 37.5%;', 'width: 37.5%;', 'width: 25%;']);
    expect(memoryTile(wrapper).find('[data-overflow]').exists()).toBe(false);
  });

  it('keys models as Unknown rather than zero where the agent reports no instances', async () => {
    getNodeTelemetryStatus.mockResolvedValue(
      heldBy([], { heldByModelsBytes: 0, heldByModelsUnknown: true, memoryAvailableBytes: 384 * GIB })
    );

    const { wrapper } = await mountNode();

    expect(memoryDetail(wrapper)).toBe('At most 384 GiB free');
    expect(memoryLegend(wrapper)).toEqual(['Models Unknown', 'Other 128 GiB']);
  });

  it('shows no meter on a host that did not report its memory', async () => {
    getNodeTelemetryStatus.mockResolvedValue(heldBy([], { memoryTotalBytes: 0 }));

    const { wrapper } = await mountNode();

    expect(memoryTile(wrapper).find('[data-testid="kpi-meter"]').exists()).toBe(false);
    expect(memoryTile(wrapper).text()).toContain('Not reported');
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

  it.each([
    {
      name: 'a figure',
      instanceMemory: [{ instanceKey: 'instance-a', heldBytes: 2 * GIB, residentBytes: 12 * GIB }],
      expected: '12 GiB',
    },
    {
      name: 'an unread process',
      instanceMemory: [{ instanceKey: 'instance-a', heldBytes: null, residentBytes: null }],
      expected: 'Unknown',
    },
    { name: 'no entry', instanceMemory: [], expected: '-' },
  ])('reads the RAM column from telemetry for $name', async ({ instanceMemory, expected }) => {
    getNodeTelemetryStatus.mockResolvedValue(status({ host: { ...status().host!, instanceMemory } }));

    const { wrapper } = await mountNode();

    expect(wrapper.get('[data-testid="instances-card"]').text()).toContain('RAM');
    expect(wrapper.get('[data-testid="instances-card"]').text()).not.toContain('RAM held');
    expect(wrapper.get('[data-testid="instance-resident-memory"]').text()).toBe(expected);
  });

  it('tells a node that never reported from one that has no GPUs', async () => {
    getNodeTelemetryStatus.mockResolvedValue(status({ telemetryState: null, host: null, devices: [] }));
    getNode.mockResolvedValue(node({ state: NodeState.REGISTERED, lastSeenDate: null }));

    const { wrapper } = await mountNode();

    expect(wrapper.text()).toContain('Waiting for agent');
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
    expect(useToastStore().toasts.at(-1)?.title).toBe('Model scan started');
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

  it('scrolls the models in a region under a head that sticks, with no pages while they fit on one', async () => {
    const { wrapper } = await mountNode();

    const card = wrapper.get('[data-testid="models-card"]');
    const region = card.get('[role="region"]');

    expect(region.attributes('aria-label')).toBe('Models');
    expect(region.find('[data-testid="model-row"]').exists()).toBe(true);
    expect(region.get('[data-testid="table-head"]').classes()).toContain('sticky');
    expect(card.find('nav[aria-label="Pagination"]').exists()).toBe(false);
  });

  it('scrolls the event log above its pages and opens each new page at its first row', async () => {
    getEventList.mockResolvedValue({ eventList: [], pages: 2 });

    const { wrapper } = await mountNode();

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

  it('pages the models below their rows and opens each new page at its first row', async () => {
    getNodeModelInventory.mockResolvedValue({ models: modelsNumbered(25) });

    const { wrapper } = await mountNode();

    const card = wrapper.get('[data-testid="models-card"]');
    const region = card.get('[role="region"]');

    expect(region.findAll('[data-testid="model-row"]')).toHaveLength(20);
    expect(region.find('nav[aria-label="Pagination"]').exists()).toBe(false);
    expect(card.find('nav[aria-label="Pagination"]').exists()).toBe(true);

    region.element.scrollTop = 200;

    await card.get('button[aria-label="Page 2"]').trigger('click');
    await flushPromises();

    const nextRegion = card.get('[role="region"]');

    expect(nextRegion.findAll('[data-testid="model-row"]')).toHaveLength(5);
    expect(nextRegion.element.scrollTop).toBe(0);
  });

  it('falls back to the last page when a rescan leaves fewer models than the page being read', async () => {
    getNodeModelInventory.mockResolvedValue({ models: modelsNumbered(25) });

    const { wrapper } = await mountNode();

    const card = wrapper.get('[data-testid="models-card"]');

    await card.get('button[aria-label="Page 2"]').trigger('click');

    getNodeModelInventory.mockResolvedValue({ models: modelsNumbered(3) });

    const onReconnect = streamEvents.mock.calls[0][1] as () => void;

    onReconnect();
    await flushPromises();

    expect(card.findAll('[data-testid="model-row"]')).toHaveLength(3);
    expect(card.find('nav[aria-label="Pagination"]').exists()).toBe(false);
  });

  it('keeps the event log where it was scrolled when a live event refreshes the first page', async () => {
    const { wrapper } = await mountNode();

    const region = wrapper.get('[data-testid="event-log-card"] [role="region"]');

    region.element.scrollTop = 200;

    const onLiveEvent = streamEvents.mock.calls[0][0] as (event: Partial<EventDto>) => void;

    getEventList.mockClear();
    onLiveEvent({ subjectType: EventPartyType.NODE, subjectId: '3', type: EventType.NODE_CONNECTED });
    await flushPromises();

    expect(getEventList).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="event-log-card"] [role="region"]').element.scrollTop).toBe(200);
  });
});
