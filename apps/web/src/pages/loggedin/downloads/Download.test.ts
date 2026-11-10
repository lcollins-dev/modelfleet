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
import { useToastStore } from '@/stores/toast';

import { UiPageContainer } from '@/components/ui';

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
  modelDirectory: '/models',
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
      { path: '/downloads', component: { template: '<div />' } },
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

    const rows = wrapper.findAll('[data-testid="download-target"]');

    expect(rows[0].text()).toContain('Waiting for the node to report');
    expect(rows[1].text()).toContain('10 MiB/s');
    expect(rows[1].text()).toContain('20s');
    expect(rows[1].text()).toContain('100 MiB / 300 MiB (33%)');
  });

  it('names the model directory each node lands the download in, or its first where the download named none', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.ACTIVE, [
        target({ modelDirectory: '/bulk' }),
        target({ nodeId: 2, nodeName: 'rig-02', modelDirectory: null }),
      ])
    );

    const { wrapper } = await mountDownload();
    const directories = wrapper.findAll('[data-testid="download-target-model-directory"]');

    expect(directories.map(directory => directory.text())).toEqual(['/bulk', 'First model directory']);
  });

  it('leaves the files and the repository the title names out of the details', async () => {
    getDownload.mockResolvedValue(download(DownloadState.ACTIVE, [target()]));

    const { wrapper } = await mountDownload();
    const details = wrapper.get('[data-testid="download-details"]').text();

    expect(details).not.toContain('Repository');
    expect(details).not.toContain('Files');
    expect(details).not.toContain('mmproj.gguf');
  });

  it('uses the wide container', async () => {
    getDownload.mockResolvedValue(download(DownloadState.ACTIVE, [target()]));

    const { wrapper } = await mountDownload();

    expect(wrapper.findComponent(UiPageContainer).props('wide')).toBe(true);
  });

  it('lists every file with its size in a scrolling table above the nodes', async () => {
    const files = Array.from({ length: 64 }, (_, index) => ({
      path: `Q4/model-${String(index + 1).padStart(5, '0')}-of-00064.gguf`,
      sizeBytes: 2 * MIB,
    }));

    getDownload.mockResolvedValue({ ...download(DownloadState.ACTIVE, [target()]), files });

    const { wrapper } = await mountDownload();
    const card = wrapper.get('[data-testid="download-files"]');
    const rows = card.findAll('[data-testid="download-file"]');

    expect(rows).toHaveLength(64);
    expect(rows[4].text()).toBe('Q4/model-00005-of-00064.gguf2 MiB');
    expect(card.text()).toContain('64 files · 128 MiB');
    expect(card.get('[role="region"]').classes()).toContain('max-h-96');
    expect(card.get('[data-testid="table-head"]').classes()).toContain('sticky');

    const html = wrapper.html();

    expect(html.indexOf('download-files')).toBeLessThan(html.indexOf('download-target'));
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
    expect(useToastStore().toasts.map(toast => toast.title)).toEqual(['Download restarted']);
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

    const files = wrapper.findAll('[data-testid="download-target-file"]').map(row => row.text());

    expect(files).toEqual(['model.ggufDone200 MiB / 200 MiB (100%)', 'mmproj.ggufDownloading50 MiB / 100 MiB (50%)']);
  });

  it.each([
    ['done', DownloadTargetState.SUCCEEDED, DownloadState.COMPLETED],
    ['failed', DownloadTargetState.FAILED, DownloadState.FAILED],
    ['stopped', DownloadTargetState.STOPPED, DownloadState.STOPPED],
  ])('has nothing to expand on a %s node', async (_name, state, downloadState) => {
    getDownload.mockResolvedValue(
      download(downloadState, [
        target({
          state,
          files: [
            { path: 'model.gguf', state: null, bytesDone: 0 },
            { path: 'mmproj.gguf', state: null, bytesDone: 0 },
          ],
        }),
      ])
    );

    const { wrapper } = await mountDownload();

    expect(wrapper.find('[data-testid="download-target"] button[aria-label="Show details"]').exists()).toBe(false);
  });

  it('keeps the chevron to the node still downloading where another has settled', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.ACTIVE, [
        target({ state: DownloadTargetState.SUCCEEDED, bytesDone: 300 * MIB }),
        target({ nodeId: 2, nodeName: 'rig-02' }),
      ])
    );

    const { wrapper } = await mountDownload();
    const chevrons = wrapper
      .findAll('[data-testid="download-target"]')
      .map(row => row.find('button[aria-label="Show details"]').exists());

    expect(chevrons).toEqual([false, true]);
  });

  it.each([
    ['failed', DownloadTargetState.FAILED, DownloadState.FAILED],
    ['stopped', DownloadTargetState.STOPPED, DownloadState.STOPPED],
  ])('reads a %s node as a dash rather than 0%%', async (_name, state, downloadState) => {
    getDownload.mockResolvedValue(download(downloadState, [target({ state })]));

    const { wrapper } = await mountDownload();
    const row = wrapper.get('[data-testid="download-target"]');

    expect(row.get('[data-testid="download-target-no-progress"]').text()).toBe('-');
    expect(row.text()).not.toContain('0%');
  });

  it('keeps the bytes and percentage of a done node', async () => {
    getDownload.mockResolvedValue(
      download(DownloadState.COMPLETED, [target({ state: DownloadTargetState.SUCCEEDED, bytesDone: 300 * MIB })])
    );

    const { wrapper } = await mountDownload();
    const row = wrapper.get('[data-testid="download-target"]');

    expect(row.find('[data-testid="download-target-no-progress"]').exists()).toBe(false);
    expect(row.text()).toContain('300 MiB / 300 MiB (100%)');
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
