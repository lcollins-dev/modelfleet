import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { DownloadDto, DownloadProgressResponseDto } from '@libs/dto';
import { DownloadProgressState, DownloadSource, DownloadState, DownloadTargetState, NodeState } from '@libs/dto';

import { Config } from '@/Config';

import Index from './Index.vue';

const getDownloadList = vi.fn();
const streamDownloadProgress = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/DownloadAdminService', () => ({
  useDownloadAdminService: () => ({ getDownloadList, streamDownloadProgress }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const download = (id: number, state: DownloadState): DownloadDto => ({
  id,
  key: `key-${id}`,
  source: DownloadSource.HUGGINGFACE,
  repository: `owner/repo-${id}`,
  directory: `huggingface/owner/repo-${id}`,
  revision: 'a'.repeat(40),
  state,
  files: [{ path: 'model.gguf', sizeBytes: 1000 }],
  targets: [
    {
      nodeId: 1,
      nodeName: 'rig-01',
      nodeState: NodeState.ONLINE,
      state: state === DownloadState.ACTIVE ? DownloadTargetState.ACTIVE : DownloadTargetState.SUCCEEDED,
      progress: null,
      message: null,
      bytesDone: state === DownloadState.ACTIVE ? 0 : 1000,
      totalBytes: 1000,
      bytesPerSecond: null,
      files: [],
      settledDate: null,
    },
  ],
  bytesDone: state === DownloadState.ACTIVE ? 0 : 1000,
  totalBytes: 1000,
  createdDate: new Date('2026-10-13T09:14:00.000Z'),
});

const COUNTS = {
  [DownloadState.ACTIVE]: 1,
  [DownloadState.FAILED]: 0,
  [DownloadState.STOPPED]: 0,
  [DownloadState.COMPLETED]: 2,
};

const mountIndex = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:path(.*)*', component: { template: '<div />' } }],
  });
  await router.push('/downloads');

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

  getDownloadList.mockResolvedValue({
    downloadList: [download(1, DownloadState.ACTIVE), download(2, DownloadState.COMPLETED)],
    counts: COUNTS,
    pages: 1,
  });
  streamDownloadProgress.mockImplementation(subscription);
  streamEvents.mockImplementation(subscription);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Downloads page', () => {
  it('lists each download with its state, nodes and progress, linking through, against the total', async () => {
    const wrapper = await mountIndex();

    const rows = wrapper.findAll('[data-testid="download"]');

    expect(rows[0].text()).toContain('owner/repo-1');
    expect(rows[0].text()).toContain('Downloading to rig-01 · 1 file');
    expect(rows[0].text()).toContain('Downloading');
    expect(rows[0].get('[data-testid="table-row-link"]').attributes('href')).toBe('/downloads/1');
    expect(rows[1].text()).toContain('Done');

    expect(wrapper.get('[data-testid="download-count"]').text()).toBe('Showing 2 of 3 downloads');
  });

  it('lays the bytes the nodes report over the rows', async () => {
    const wrapper = await mountIndex();

    const onProgress = streamDownloadProgress.mock.calls[0][0] as (progress: DownloadProgressResponseDto) => void;

    onProgress({
      downloads: [
        {
          key: 'key-1',
          targets: [
            {
              nodeId: 1,
              progress: DownloadProgressState.DOWNLOADING,
              bytesDone: 500,
              bytesPerSecond: 100,
              files: [],
            },
          ],
        },
      ],
    });
    await flushPromises();

    expect(wrapper.findAll('[data-testid="download"]')[0].text()).toContain('(50%)');
  });

  it('narrows by state, offering each with its count', async () => {
    const wrapper = await mountIndex();

    await wrapper.get('[role="combobox"][aria-label="State"]').trigger('click');

    const options = wrapper.findAll('[role="option"]');

    expect(options.map(option => option.text())).toEqual([
      'All downloads',
      'Downloading1 download',
      'Failed0 downloads',
      'Stopped0 downloads',
      'Done2 downloads',
    ]);

    await options[4].trigger('click');
    await settle();

    expect(getDownloadList).toHaveBeenLastCalledWith({ state: DownloadState.COMPLETED }, 1);
  });

  it('says there are no downloads yet, leaving creation to the heading, and says when a search matches nothing', async () => {
    getDownloadList.mockResolvedValue({
      downloadList: [],
      counts: { ...COUNTS, [DownloadState.ACTIVE]: 0, [DownloadState.COMPLETED]: 0 },
      pages: 1,
    });

    const wrapper = await mountIndex();

    expect(wrapper.get('[data-testid="table-empty"]').text()).toContain('No downloads yet.');
    expect(wrapper.find('[data-testid="table-empty"]').findAll('a, button')).toHaveLength(0);
    expect(wrapper.find('a[href="/downloads/create"]').exists()).toBe(true);

    await wrapper.get('input').setValue('qwen');
    await settle();

    expect(getDownloadList).toHaveBeenLastCalledWith({ search: 'qwen' }, 1);
    expect(wrapper.get('[data-testid="table-empty"]').text()).toBe('No downloads match your search.');
  });
});
