import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type {
  EventDto,
  FleetNodeTelemetryDto,
  FleetTelemetryResponseDto,
  InstanceListResponseDto,
  ListDeploymentDto,
  ListInstanceDto,
} from '@libs/dto';
import {
  ActivationPolicy,
  EventPartyType,
  EventSeverity,
  EventType,
  GpuVendor,
  InstanceState,
  NodeState,
  NodeTelemetryState,
  UserRoleId,
} from '@libs/dto';

import { useUserStore } from '@/stores/user';

import Dashboard from './Dashboard.vue';

const GIB = 1024 ** 3;

const getDeploymentList = vi.fn();
const getModelList = vi.fn();
const getEventList = vi.fn();
const getFleetTelemetry = vi.fn();
const streamFleetTelemetry = vi.fn();
const streamInstances = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/DeploymentAdminService', () => ({
  useDeploymentAdminService: () => ({ getDeploymentList }),
}));

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ getEventList, streamEvents }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ getFleetTelemetry, streamFleetTelemetry }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ streamInstances }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const fleetNode = (nodeId: number, nodeName: string, nodeState: NodeState): FleetNodeTelemetryDto => ({
  nodeId,
  nodeName,
  nodeState,
  status: {
    telemetryState: nodeState === NodeState.ONLINE ? NodeTelemetryState.OK : null,
    capturedAt: null,
    receivedAt: nodeState === NodeState.ONLINE ? new Date() : null,
    host: null,
    devices:
      nodeState === NodeState.ONLINE
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

const deployment = (id: number, name: string): ListDeploymentDto => ({
  id,
  name,
  modelId: 1,
  modelName: 'Llama 3.1 70B',
  modelLicence: null,
  presetId: null,
  presetName: null,
  backend: BackendId.LLAMA_CPP,
  activationPolicy: ActivationPolicy.ALWAYS,
  enabled: true,
  outOfDate: false,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
});

const instance = (deploymentId: number, state: InstanceState): ListInstanceDto => ({
  instanceKey: `instance-${deploymentId}`,
  deploymentId,
  deploymentName: `deployment-${deploymentId}`,
  nodeId: 1,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [],
  state,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
});

const event = (id: number, message: string): EventDto => ({
  id,
  type: EventType.NODE_REGISTERED,
  severity: EventSeverity.INFO,
  subjectType: EventPartyType.NODE,
  subjectId: '1',
  message,
  detail: {},
  createdDate: new Date('2026-09-22T12:00:00.000Z'),
});

const mountDashboard = async (userRoleIds: UserRoleId[] = [UserRoleId.SYSTEM_ADMIN]) => {
  const userStore = useUserStore();

  userStore.setProfile({ name: 'Ann Lee', email: 'ann@example.com', userRoleIds, mustChangePassword: false });

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/dashboard');

  const wrapper = mount(Dashboard, { global: { plugins: [router] } });
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

  getDeploymentList.mockResolvedValue({ deploymentList: [], pages: 0, total: 0 });
  getModelList.mockResolvedValue({ modelList: [], pages: 0 });
  getEventList.mockResolvedValue({ eventList: [], pages: 0 });
  streamFleetTelemetry.mockImplementation(subscription);
  streamInstances.mockImplementation(subscription);
  streamEvents.mockImplementation(subscription);
});

describe('Overview page', () => {
  it('shows a notice in place of the fleet to anyone but a system administrator', async () => {
    const wrapper = await mountDashboard([]);

    expect(wrapper.text()).toContain('The fleet overview is available to system administrators.');
    expect(streamFleetTelemetry).not.toHaveBeenCalled();
    expect(getDeploymentList).not.toHaveBeenCalled();
  });

  it('sums the fleet into its tiles and lists each node, linking through to it', async () => {
    const wrapper = await mountDashboard();

    await sendFleet([fleetNode(1, 'gpu-a-01', NodeState.ONLINE), fleetNode(2, 'gpu-b-02', NodeState.OFFLINE)]);

    expect(wrapper.text()).toContain('2 nodes and 1 GPU.');
    expect(wrapper.text()).toContain('20 GiB');
    expect(wrapper.text()).toContain('of 80 GiB');
    expect(wrapper.text()).toContain('25% in use');
    expect(wrapper.text()).toContain('1 online');
    expect(wrapper.text()).toContain('1 offline');

    const nodeRows = wrapper.get('[data-testid="nodes-card"]').findAll('[data-testid="fleet-node-row"]');

    expect(nodeRows.map(row => row.get('[data-testid="table-row-link"]').attributes('href'))).toEqual([
      '/nodes/1',
      '/nodes/2',
    ]);
    expect(nodeRows[1].text()).toContain('Offline');
    expect(nodeRows[1].text()).toContain('No data');
  });

  it('lists deployments with problems first, five at most, and counts every one', async () => {
    getDeploymentList.mockResolvedValue({
      deploymentList: [1, 2, 3, 4, 5, 6].map(id => deployment(id, `deployment-${id}`)),
      pages: 1,
      total: 9,
    });

    const wrapper = await mountDashboard();

    await sendInstances([instance(1, InstanceState.READY), instance(4, InstanceState.FAILED)]);

    const card = wrapper.get('[data-testid="deployments-card"]');
    const rows = card.findAll('[data-testid="fleet-deployment-row"]').map(row => row.text());

    expect(rows).toHaveLength(5);
    expect(rows[0]).toContain('deployment-4');
    expect(rows[0]).toContain('Failed');
    expect(rows[1]).toContain('deployment-1');
    expect(card.text()).toContain('1 of 9 ready. Problems are listed first.');
    expect(wrapper.text()).toContain('7 idle');
  });

  it('asks for a node and a model while the fleet is empty, then for a deployment once a model is there', async () => {
    const empty = await mountDashboard();

    await sendFleet([]);

    expect(empty.get('[data-testid="nodes-card"]').text()).toContain('Register Node');
    expect(empty.get('[data-testid="nodes-card"] [data-testid="table-empty"] a').attributes('href')).toBe(
      '/nodes/register'
    );
    expect(empty.get('[data-testid="deployments-card"]').text()).toContain('No models yet');
    expect(empty.get('[data-testid="deployments-card"] [data-testid="table-empty"] a').attributes('href')).toBe(
      '/models'
    );

    empty.unmount();
    getModelList.mockResolvedValue({ modelList: [{ id: 1 }], pages: 1 });

    const withModel = await mountDashboard();

    expect(withModel.get('[data-testid="deployments-card"]').text()).toContain('Create Deployment');
    expect(withModel.get('[data-testid="deployments-card"] [data-testid="table-empty"] a').attributes('href')).toBe(
      '/deployments/create'
    );
  });

  it('puts a live event at the top of recent activity and rereads the list its subject belongs to', async () => {
    vi.useFakeTimers();

    getEventList.mockResolvedValue({ eventList: [event(1, 'An earlier event')], pages: 1 });

    const wrapper = await mountDashboard();
    const onEvent = streamEvents.mock.calls[0][0] as (event: EventDto) => void;

    onEvent(event(2, 'A node joined'));
    await flushPromises();

    const rows = wrapper.get('[data-testid="activity-card"]').findAll('[data-testid="event-row"]');

    expect(rows.map(row => row.text())).toEqual([
      expect.stringContaining('A node joined'),
      expect.stringContaining('An earlier event'),
    ]);

    getFleetTelemetry.mockResolvedValue({ nodes: [], readAt: new Date() });
    await vi.runAllTimersAsync();

    expect(getFleetTelemetry).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
