import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import { BackendId } from '@libs/backends';
import type { ListPresetDto } from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getPresetList = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/PresetAdminService', () => ({
  usePresetAdminService: () => ({ getPresetList }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const listPreset = (id: number, name: string, extra: Partial<ListPresetDto> = {}): ListPresetDto => ({
  id,
  name,
  description: 'Single 4090',
  backend: BackendId.LLAMA_CPP,
  deployments: 3,
  createdDate: new Date(),
  ...extra,
});

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/presets');

  const wrapper = mount(Index, { global: { plugins: [router], stubs: { teleport: true } } });
  await flushPromises();

  return wrapper;
};

const settle = async () => {
  await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS);
  await flushPromises();
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });

  getPresetList.mockResolvedValue({
    presetList: [
      listPreset(1, 'llama.cpp standard'),
      listPreset(2, 'vLLM BF16', { description: null, backend: BackendId.VLLM, deployments: 0 }),
    ],
    pages: 1,
  });
  streamEvents.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Presets page', () => {
  it('lists each preset with its backend and use, linking through to it', async () => {
    const wrapper = await mountIndex();

    const rows = wrapper.findAll('[data-testid="preset-row"]');

    expect(rows[0].text()).toContain('llama.cpp standard');
    expect(rows[0].text()).toContain('Single 4090');
    expect(rows[0].text()).toContain('llama.cpp');
    expect(rows[0].text()).toContain('3 deployments');
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/presets/1');

    expect(rows[1].text()).toContain('No description');
    expect(rows[1].text()).toContain('vllm');
    expect(rows[1].text()).toContain('Not used');

    expect(wrapper.get('[data-testid="preset-count"]').text()).toBe('Showing 2 presets');
  });

  it('narrows by backend', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[role="combobox"][aria-label="Backend"]').trigger('click');

    const options = wrapper.findAll('[role="option"]');

    expect(options[0].text()).toBe('All backends');

    await options.find(option => option.text() === BackendId.VLLM)?.trigger('click');
    await settle();

    expect(getPresetList).toHaveBeenLastCalledWith({ backend: [BackendId.VLLM] }, 1);
  });

  it('explains an empty list, then an empty search', async () => {
    getPresetList.mockResolvedValue({ presetList: [], pages: 1 });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No presets yet.');
    expect(wrapper.find('[data-testid="table-empty"]').findAll('a, button')).toHaveLength(0);
    expect(wrapper.find('a[href="/presets/create"]').exists()).toBe(true);

    await wrapper.get('input').setValue('fp8');
    await settle();

    expect(getPresetList).toHaveBeenLastCalledWith({ search: 'fp8' }, 1);
    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No presets match your search.');
  });
});
