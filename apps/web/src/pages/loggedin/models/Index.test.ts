import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { EventDto, ListModelDto } from '@libs/dto';
import {
  EventPartyType,
  EventSeverity,
  EventType,
  ModelFormat,
  ModelState,
  ModelTask,
  ModelType,
  NodeState,
  UNKNOWN_MODEL_TASK,
} from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getModelList = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/ModelAdminService', () => ({
  useModelAdminService: () => ({ getModelList }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const listModel = (id: number, name: string, state: ModelState, nodeNames: string[]): ListModelDto => ({
  id,
  fingerprint: `${id}`.repeat(64),
  name,
  displayName: null,
  format: ModelFormat.GGUF,
  type: ModelType.MODEL,
  tasks: [ModelTask.CHAT],
  licence: null,
  quantisation: 'Q4_K_M',
  quantisationMixed: false,
  sizeBytes: 1024 ** 3,
  shardCount: 1,
  state,
  availability: nodeNames.map((nodeName, index) => ({
    nodeId: index + 1,
    nodeName,
    nodeState: NodeState.ONLINE,
    path: `/srv/weights/${name}`,
    lastConfirmedDate: new Date(),
  })),
});

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/models');

  const wrapper = mount(Index, { global: { plugins: [router], stubs: { teleport: true } } });
  await flushPromises();

  return wrapper;
};

const pick = async (wrapper: Awaited<ReturnType<typeof mountIndex>>, select: string, label: string) => {
  await wrapper.get(`[role="combobox"][aria-label="${select}"]`).trigger('click');

  const option = wrapper.findAll('[role="option"]').find(candidate => candidate.text() === label);

  if (option === undefined) {
    throw new Error(`No option reads ${label}`);
  }

  await option.trigger('click');
};

const settle = async () => {
  await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getModelList.mockResolvedValue({
    modelList: [
      listModel(1, 'llama-70b.gguf', ModelState.AVAILABLE, ['node-a', 'node-b']),
      listModel(2, 'phi-4.gguf', ModelState.UNAVAILABLE, []),
    ],
    pages: 1,
  });
  streamEvents.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Models page', () => {
  it('lists each model with its availability, node count and size, linking through to it', async () => {
    const wrapper = await mountIndex();

    const rows = wrapper.findAll('[data-testid="model-row"]');

    expect(rows[0].text()).toContain('llama-70b.gguf');
    expect(rows[0].text()).toContain('Chat · GGUF Q4_K_M');
    expect(rows[0].text()).toContain('Available');
    expect(rows[0].text()).toContain('1 GiB');
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/models/1');
    expect(rows[0].get('[title="node-a, node-b"]').text()).toBe('2');

    expect(rows[1].text()).toContain('Unavailable');

    expect(wrapper.get('[data-testid="model-count"]').text()).toBe('Showing 2 models');
  });

  it('narrows by state, type and task in the request', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[role="radio"]:nth-child(3)').trigger('click');

    await pick(wrapper, 'Type', 'Projector');
    await pick(wrapper, 'Task', 'Unknown task');
    await settle();

    expect(getModelList).toHaveBeenLastCalledWith(
      { state: [ModelState.UNAVAILABLE], type: [ModelType.PROJECTOR], task: [UNKNOWN_MODEL_TASK] },
      1
    );
  });

  it('explains an empty catalogue, then a search or a view that matches nothing', async () => {
    getModelList.mockResolvedValue({ modelList: [], pages: 1 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No models found yet.');

    await wrapper.get('input').setValue('qwen');
    await settle();

    expect(getModelList).toHaveBeenLastCalledWith({ search: 'qwen' }, 1);
    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No models match your search.');

    await wrapper.get('[role="radio"]:nth-child(2)').trigger('click');
    await settle();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No models in this view.');
  });

  it('pages through the catalogue', async () => {
    getModelList.mockResolvedValue({ modelList: [listModel(1, 'llama.gguf', ModelState.AVAILABLE, [])], pages: 3 });

    const wrapper = await mountIndex();

    await wrapper.get('[data-testid="table-footer"] button[aria-label="Page 2"]').trigger('click');
    await flushPromises();

    expect(getModelList).toHaveBeenLastCalledWith({}, 2);
  });

  it('refetches when a scan writes a model event', async () => {
    await mountIndex();

    const onEvent = streamEvents.mock.calls[0][0] as (event: EventDto) => void;

    onEvent({
      id: 1,
      type: EventType.MODEL_DISCOVERED,
      severity: EventSeverity.INFO,
      subjectType: EventPartyType.MODEL,
      subjectId: '3',
      message: 'Discovered qwen.gguf',
      detail: {},
      createdDate: new Date(),
    });
    await settle();

    expect(getModelList).toHaveBeenCalledTimes(2);
  });
});
