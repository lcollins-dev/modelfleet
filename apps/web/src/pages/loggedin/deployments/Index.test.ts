import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type { InstanceListResponseDto, ListDeploymentDto, ListInstanceDto } from '@libs/dto';
import { ActivationPolicy, InstanceState, LicenceTerms, NodeState } from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getDeploymentList = vi.fn();
const streamEvents = vi.fn();
const streamInstances = vi.fn();

vi.mock('@/services/api/admin/DeploymentAdminService', () => ({
  useDeploymentAdminService: () => ({ getDeploymentList }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

vi.mock('@/services/api/admin/InstanceAdminService', () => ({
  useInstanceAdminService: () => ({ streamInstances }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const listDeployment = (id: number, name: string, extra: Partial<ListDeploymentDto> = {}): ListDeploymentDto => ({
  id,
  name,
  modelId: id,
  modelName: 'Llama-3.1-70B',
  modelLicence: null,
  presetId: 2,
  presetName: 'llama.cpp standard',
  backend: BackendId.LLAMA_CPP,
  activationPolicy: ActivationPolicy.ALWAYS,
  enabled: true,
  outOfDate: false,
  createdDate: new Date(),
  ...extra,
});

const instance = (deploymentId: number, state: InstanceState): ListInstanceDto => ({
  instanceKey: `i-${deploymentId}-${state}`,
  deploymentId,
  deploymentName: 'llama-70b-chat',
  nodeId: 3,
  nodeName: 'gpu-a-01',
  nodeState: NodeState.ONLINE,
  devices: [],
  state,
  message: null,
  exitCode: null,
  startedDate: null,
  reportedDate: null,
  createdDate: new Date(),
});

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/deployments');

  const wrapper = mount(Index, { global: { plugins: [router] } });
  await flushPromises();

  return wrapper;
};

const pushInstances = async (instances: ListInstanceDto[]) => {
  const onInstances = streamInstances.mock.calls[0][0] as (response: InstanceListResponseDto) => void;

  onInstances({ instances });
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getDeploymentList.mockResolvedValue({
    deploymentList: [
      listDeployment(1, 'llama-70b-chat', {
        outOfDate: true,
        modelLicence: { id: 'cc-by-nc-4.0', name: null, link: null, terms: LicenceTerms.NON_COMMERCIAL },
      }),
      listDeployment(2, 'embed', { enabled: false, presetName: null, activationPolicy: ActivationPolicy.ON_DEMAND }),
    ],
    pages: 1,
    total: 3,
  });
  streamEvents.mockImplementation(subscription);
  streamInstances.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Deployments page', () => {
  it('lists each deployment with its model, state, activation and instances, linking through to it', async () => {
    const wrapper = await mountIndex();

    await pushInstances([instance(1, InstanceState.READY), instance(1, InstanceState.STARTING)]);

    const rows = wrapper.findAll('[data-testid="deployment-row"]');

    expect(rows[0].text()).toContain('llama-70b-chat');
    expect(rows[0].text()).toContain('Llama-3.1-70B · llama.cpp · llama.cpp standard');
    expect(rows[0].text()).toContain('Non-commercial');
    expect(rows[0].text()).toContain('Starting');
    expect(rows[0].text()).toContain('Out of date');
    expect(rows[0].text()).toContain('Always on');
    expect(rows[0].text()).toContain('2');
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/deployments/1');

    expect(rows[1].text()).toContain('no preset');
    expect(rows[1].text()).toContain('Disabled');
    expect(rows[1].text()).not.toContain('Idle');
    expect(rows[1].text()).toContain('On demand');

    expect(wrapper.get('[data-testid="deployment-count"]').text()).toBe('Showing 2 of 3 deployments');
  });

  it('shows a disabled deployment still running as both', async () => {
    const wrapper = await mountIndex();

    await pushInstances([instance(2, InstanceState.READY)]);

    const row = wrapper.findAll('[data-testid="deployment-row"]')[1];

    expect(row.text()).toContain('Ready');
    expect(row.text()).toContain('Disabled');
  });

  it('searches by name, and explains an empty list then an empty search', async () => {
    getDeploymentList.mockResolvedValue({ deploymentList: [], pages: 1, total: 0 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No deployments yet.');
    expect(wrapper.find('[data-testid="table-empty"]').findAll('a, button')).toHaveLength(0);
    expect(wrapper.find('a[href="/deployments/create"]').exists()).toBe(true);

    await wrapper.get('input').setValue('qwen');
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
    await flushPromises();

    expect(getDeploymentList).toHaveBeenLastCalledWith({ search: 'qwen' }, 1);
    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No deployments match your search.');
  });
});
