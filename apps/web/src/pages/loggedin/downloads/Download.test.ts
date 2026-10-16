import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import type { DownloadDto, DownloadTargetDto } from '@libs/dto';
import {
  DownloadFileState,
  DownloadProgressState,
  DownloadSource,
  DownloadState,
  DownloadTargetState,
  NodeState,
} from '@libs/dto';

import { useDialogStore } from '@/stores/dialog';
import { useNotificationStore } from '@/stores/notification';

import Download from './Download.vue';

const getDownload = vi.fn();
const streamDownloadProgress = vi.fn();
const stopDownload = vi.fn();
const retryDownload = vi.fn();
const dismissDownload = vi.fn();
const streamEvents = vi.fn();

vi.mock('@/services/api/admin/DownloadAdminService', () => ({
  useDownloadAdminService: () => ({
    getDownload,
    streamDownloadProgress,
    stopDownload,
    retryDownload,
    dismissDownload,
  }),
}));

vi.mock('@/services/api/admin/EventAdminService', () => ({
  useEventAdminService: () => ({ streamEvents }),
}));

const MIB = 1024 ** 2;

const subscription = () => ({ connected: ref(true), lastActivityDate: ref(new Date()), close: vi.fn() });

const target = (overrides: Partial<DownloadTargetDto> = {}): DownloadTargetDto => ({
  nodeId: 1,
  nodeName: 'rig-01',
  nodeState: NodeState.ONLINE,
  state: DownloadTargetState.ACTIVE,
  progress: null,
  message: null,
  bytesDone: 0,
  totalBytes: 300 * MIB,
  bytesPerSecond: null,
  files: [],
  settledDate: null,
  ...overrides,
});

const download = (state: DownloadState, targets: DownloadTargetDto[]): DownloadDto => ({
  id: 7,
  key: 'key-7',
  source: DownloadSource.HUGGINGFACE,
  repository: 'owner/repo',
  directory: 'huggingface/owner/repo',
  revision: 'a'.repeat(40),
  state,
  files: [
    { path: 'model.gguf', sizeBytes: 200 * MIB },
    { path: 'mmproj.gguf', sizeBytes: 100 * MIB },
  ],
  targets,
  bytesDone: 0,
  totalBytes: 300 * MIB * targets.length,
  createdByName: 'Admin',
  createdDate: new Date('2026-10-13T09:14:00.000Z'),
});

const mountDownload = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/downloads/:downloadId', component: { template: '<div />' } },
      { path: '/:path(.*)*', component: { template: '<div />' } },
    ],
  });
  await router.push('/downloads/7');

  const wrapper = mount(Download, { global: { plugins: [router] } });
  await flushPromises();

  return { wrapper, router };
};

const button = (wrapper: Awaited<ReturnType<typeof mountDownload>>['wrapper'], text: string) => {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === text);

  if (found === undefined) {
    throw new Error(`No button reads ${text}`);
  }

  return found;
};

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();

  streamDownloadProgress.mockImplementation(subscription);
  streamEvents.mockImplementation(subscription);
  stopDownload.mockResolvedValue(undefined);
  retryDownload.mockResolvedValue(undefined);
  dismissDownload.mockResolvedValue(undefined);
});

describe('Download page', () => {
  it('reads the details, and each node with what it is doing, its speed and its time left', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.ACTIVE, [
        target(),
        target({
          nodeId: 2,
          nodeName: 'rig-02',
          progress: DownloadProgressState.DOWNLOADING,
          bytesDone: 100 * MIB,
          bytesPerSecond: 10 * MIB,
        }),
      ])
    );

    const { wrapper } = await mountDownload();

    expect(wrapper.get('[data-testid="download-state"]').text()).toBe('Downloading');
    expect(wrapper.get('[data-testid="download-details"]').text()).toContain('huggingface/owner/repo');
    expect(wrapper.get('[data-testid="download-details"]').text()).toContain('mmproj.gguf');

    const rows = wrapper.findAll('[data-testid="download-target"]');

    expect(rows[0].text()).toContain('Waiting for the node to report');
    expect(rows[1].text()).toContain('10 MiB/s');
    expect(rows[1].text()).toContain('20s');
  });

  it('stops one node alone where the download names several', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.ACTIVE, [target(), target({ nodeId: 2, nodeName: 'rig-02' })])
    );

    const { wrapper } = await mountDownload();

    await wrapper
      .findAll('[data-testid="download-target"]')[1]
      .findAll('button')
      .find(found => found.text() === 'Stop')
      ?.trigger('click');
    await flushPromises();

    expect(stopDownload).toHaveBeenCalledWith(7, { nodeId: 2 });
  });

  it('asks before cancelling the download on every node', async () => {
    getDownload.mockResolvedValue(download(DownloadState.ACTIVE, [target()]));

    const { wrapper } = await mountDownload();
    const confirm = vi.spyOn(useDialogStore(), 'confirm').mockResolvedValue(true);

    await wrapper.get('[data-testid="download-cancel"]').trigger('click');

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Cancel the download of owner/repo?' }));
    expect(wrapper.findAll('button').some(found => found.text() === 'Dismiss')).toBe(false);
  });

  it('names a node whose copy failed, with its reason, and retries it once no node is downloading', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.FAILED, [
        target({ state: DownloadTargetState.SUCCEEDED, bytesDone: 300 * MIB }),
        target({
          nodeId: 2,
          nodeName: 'rig-02',
          state: DownloadTargetState.FAILED,
          message: 'model.gguf did not match its digest',
        }),
      ])
    );

    const { wrapper } = await mountDownload();
    const failure = wrapper.get('[data-testid="download-failure"]');

    expect(failure.text()).toContain('The copy on rig-02 failed');
    expect(failure.text()).toContain('model.gguf did not match its digest');

    await failure.get('button').trigger('click');
    await flushPromises();

    expect(retryDownload).toHaveBeenCalledWith(7);
    expect(useNotificationStore().notifications.map(notification => notification.title)).toEqual([
      'Download restarted',
    ]);
  });

  it('opens a node to show how far each file has got', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.ACTIVE, [
        target({
          files: [
            { path: 'model.gguf', state: DownloadFileState.DONE, bytesDone: 200 * MIB },
            { path: 'mmproj.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 50 * MIB },
          ],
        }),
      ])
    );

    const { wrapper } = await mountDownload();

    await wrapper.get('[data-testid="download-target"] button[aria-label="Show details"]').trigger('click');

    const files = wrapper.get('[data-testid="download-target-files"]').text();

    expect(files).toContain('Done · 200 MiB / 200 MiB (100%)');
    expect(files).toContain('Downloading · 50 MiB / 100 MiB (50%)');
  });

  it('opens a node from its name without expanding its row', async () => {
    getDownload.mockResolvedValue(download(DownloadState.ACTIVE, [target()]));

    const { wrapper, router } = await mountDownload();

    const link = wrapper.get('[data-testid="download-target-node-link"]');

    expect(link.attributes('href')).toBe('/nodes/1');

    await link.trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="download-target-files"]').exists()).toBe(false);
    expect(router.currentRoute.value.path).toBe('/nodes/1');
  });

  it('dismisses a settled download and leaves for the list', async () => {
    getDownload.mockResolvedValue(download(DownloadState.STOPPED, [target({ state: DownloadTargetState.STOPPED })]));

    const { wrapper, router } = await mountDownload();

    await button(wrapper, 'Dismiss').trigger('click');
    await flushPromises();

    expect(dismissDownload).toHaveBeenCalledWith(7);
    expect(router.currentRoute.value.path).toBe('/downloads');
  });
});
