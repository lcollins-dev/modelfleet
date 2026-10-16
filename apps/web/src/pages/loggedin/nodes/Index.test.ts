import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type {
  EventDto,
  FleetNodeTelemetryDto,
  FleetTelemetryResponseDto,
  InstanceListResponseDto,
  ListInstanceDto,
  ListNodeDto,
} from '@libs/dto';
import {
  EventPartyType,
  EventSeverity,
  EventType,
  GpuVendor,
  InstanceState,
  NodeState,
  NodeTelemetryState,
} from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const GIB = 1024 ** 3;

const getNodeList = vi.fn();
const getFleetTelemetry = vi.fn();
const streamFleetTelemetry = vi.fn();
const streamInstances = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getFleetTelemetry, streamFleetTelemetry }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ streamInstances }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const listNode = (id: number, name: string, state: NodeState, lastSeenDate: Date | null): ListNodeDto => ({
  id,
  name,
  state,
  enabled: state !== NodeState.DISABLED,
  lastSeenDate,
  agentVersion: lastSeenDate === null ? null : '0.9.4',
});

const fleetNode = (nodeId: number, reported: boolean): FleetNodeTelemetryDto => ({
  nodeId,
  nodeName: `node-${nodeId}`,
  nodeState: reported ? NodeState.ONLINE : NodeState.REGISTERED,
  status: {
    telemetryState: reported ? NodeTelemetryState.OK : null,
    capturedAt: null,
    receivedAt: null,
    host: null,
    devices: reported
      ? [
          {
            deviceKey: 'GPU-4f2c',
            vendor: GpuVendor.NVIDIA,
            name: 'NVIDIA A100-SXM4-80GB',
            pciBusId: null,
            memoryTotalBytes: 80 * GIB,
            lastReportedDate: new Date(),
            index: 0,
            memoryUsedBytes: 20 * GIB,
            utilisationPercent: null,
            temperatureC: null,
            powerDrawWatts: null,
            processAttribution: null,
            processes: [],
            predictions: [],
          },
        ]
      : [],
    errors: [],
    headroomBytes: GIB,
  },
});

const instance = (instanceKey: string, nodeId: number): ListInstanceDto => ({
  instanceKey,
  deploymentId: 1,
  deploymentName: 'llama-70b-chat',
  nodeId,
  nodeName: `node-${nodeId}`,
  nodeState: NodeState.ONLINE,
  devices: [],
  state: InstanceState.READY,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
});

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/nodes');

  const wrapper = mount(Index, { global: { plugins: [router] } });
  await flushPromises();

  return wrapper;
};

const sendFleet = async (nodes: FleetNodeTelemetryDto[]) => {
  const onFleet = streamFleetTelemetry.mock.calls[0][0] as (fleet: FleetTelemetryResponseDto) => void;

  onFleet({ nodes, readAt: new Date() });
  await flushPromises();
};

const sendInstances = async (instances: ListInstanceDto[]) => {
  const onInstances = streamInstances.mock.calls[0][0] as (response: InstanceListResponseDto) => void;

  onInstances({ instances });
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getNodeList.mockResolvedValue({
    nodeList: [
      listNode(1, 'gpu-a-01', NodeState.ONLINE, new Date()),
      listNode(2, 'gpu-b-02', NodeState.REGISTERED, null),
    ],
    pages: 1,
  });
  getFleetTelemetry.mockResolvedValue({ nodes: [], readAt: new Date() });
  streamFleetTelemetry.mockImplementation(subscription);
  streamInstances.mockImplementation(subscription);
  streamEvents.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Nodes page', () => {
  it('lists each node with its state, heartbeat, GPUs and instances, linking through to it', async () => {
    const wrapper = await mountIndex();

    await sendFleet([fleetNode(1, true), fleetNode(2, false), fleetNode(3, true)]);
    await sendInstances([instance('a', 1), instance('b', 1)]);

    const rows = wrapper.findAll('[data-testid="node-row"]');

    expect(rows[0].text()).toContain('gpu-a-01');
    expect(rows[0].text()).toContain('agent 0.9.4');
    expect(rows[0].text()).toContain('Online');
    expect(rows[0].text()).toContain('20 GiB of 80 GiB');
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/nodes/1');

    expect(rows[1].text()).toContain('Awaiting first contact');
    expect(rows[1].text()).toContain('Never');
    expect(rows[1].text()).not.toContain('agent');

    expect(rows[0].findAll('span.font-mono').map(cell => cell.text())).toEqual(['1', '2']);
    expect(rows[1].findAll('span.font-mono').map(cell => cell.text())).toEqual(['-', '-']);

    expect(wrapper.get('[data-testid="node-count"]').text()).toBe('Showing 2 of 3 nodes');
  });

  it('narrows to inactive nodes as those awaiting first contact or disabled', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[role="radio"]:nth-child(4)').trigger('click');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(getNodeList).toHaveBeenLastCalledWith({ state: [NodeState.REGISTERED, NodeState.DISABLED] }, 1);
  });

  it('says the fleet has no nodes yet, leaving registration to the heading, and says when a search matches none', async () => {
    getNodeList.mockResolvedValue({ nodeList: [], pages: 1 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No nodes yet.');
    expect(wrapper.find('[data-testid="table-empty"]').findAll('a, button')).toHaveLength(0);
    expect(wrapper.find('a[href="/nodes/register"]').exists()).toBe(true);

    await wrapper.get('input').setValue('rig');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No nodes match your search.');
  });

  it('refetches the fleet on a node event, since registrations reach no telemetry stream', async () => {
    await mountIndex();

    const onEvent = streamEvents.mock.calls[0][0] as (event: EventDto) => void;

    onEvent({
      id: 1,
      type: EventType.NODE_REGISTERED,
      severity: EventSeverity.INFO,
      subjectType: EventPartyType.NODE,
      subjectId: '3',
      message: 'Registered node gpu-c-03',
      detail: {},
      createdDate: new Date(),
    });
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(getFleetTelemetry).toHaveBeenCalledTimes(1);
    expect(getNodeList).toHaveBeenCalledTimes(2);
  });
});
