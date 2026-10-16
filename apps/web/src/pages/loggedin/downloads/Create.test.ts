import { DOMWrapper, VueWrapper, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetTelemetryResponseDto, NodeHostTelemetryDto, RepositoryListingResponseDto } from '@libs/dto';
import { ModelDirectoryWriteAccess, NodeState, NodeTelemetryState } from '@libs/dto';

import { ValidationError } from '@/types/error';

import { Config } from '@/Config';

import { useErrorStore } from '@/stores/error';

import Create from './Create.vue';

type ChecklistTestId = 'download-files' | 'download-nodes';

const GIB = 1024 ** 3;
const COMMIT = '50968a4468ef4233ed78cd7c3de230dd1d61a56b';

const getRepositoryListing = vi.fn();
const createDownload = vi.fn();
const getNodeList = vi.fn();
const streamFleetTelemetry = vi.fn();
const push = vi.fn();

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRouter: () => ({ push }),
}));

vi.mock('@/services/api/admin/DownloadAdminService', () => ({
  useDownloadAdminService: () => ({ getRepositoryListing, createDownload }),
}));

vi.mock('@/services/api/admin/NodeAdminService', () => ({
  useNodeAdminService: () => ({ getNodeList }),
}));

vi.mock('@/services/api/admin/TelemetryAdminService', () => ({
  useTelemetryAdminService: () => ({ streamFleetTelemetry }),
}));

const listing = (overrides: Partial<RepositoryListingResponseDto> = {}): RepositoryListingResponseDto => ({
  repository: 'unsloth/Qwen3-0.6B-GGUF',
  revision: COMMIT,
  files: [
    { path: 'Qwen3-0.6B-Q4_K_M.gguf', sizeBytes: 3 * GIB },
    { path: 'Qwen3-0.6B-Q8_0.gguf', sizeBytes: 6 * GIB },
    { path: 'README.md', sizeBytes: 1024 },
  ],
  truncated: false,
  maxFilesPerDownload: 64,
  ...overrides,
});

const host = (freeBytes: number): NodeHostTelemetryDto => ({
  cpuModel: null,
  cpuCount: 8,
  loadAverage1m: null,
  memoryTotalBytes: 32 * GIB,
  memoryFreeBytes: 16 * GIB,
  modelDirectories: [
    { path: '/models', freeBytes, totalBytes: 100 * GIB, writeAccess: ModelDirectoryWriteAccess.WRITABLE },
  ],
});

const fleet = (hosts: [number, NodeHostTelemetryDto | null][]): FleetTelemetryResponseDto => ({
  nodes: hosts.map(([nodeId, nodeHost]) => ({
    nodeId,
    nodeName: `rig-0${nodeId}`,
    nodeState: NodeState.ONLINE,
    status: {
      telemetryState: NodeTelemetryState.OK,
      capturedAt: null,
      receivedAt: null,
      host: nodeHost,
      devices: [],
      errors: [],
      headroomBytes: GIB,
    },
  })),
  readAt: new Date('2026-09-26T12:00:00.000Z'),
});

describe('Create download', () => {
  let onFleet: (response: FleetTelemetryResponseDto) => void;

  const render = async (): Promise<VueWrapper> => {
    const wrapper = mount(Create, { global: { stubs: { UiPageHeading: true } } });

    await flushPromises();

    return wrapper;
  };

  const inputs = (wrapper: VueWrapper): DOMWrapper<HTMLInputElement>[] => wrapper.findAll('input');

  const rows = (wrapper: VueWrapper, list: ChecklistTestId) =>
    wrapper.findAll(`[data-testid="${list}"] [data-testid="picker-row"]`);

  const row = (wrapper: VueWrapper, list: ChecklistTestId, text: string) => {
    const found = rows(wrapper, list).find(candidate => candidate.text().includes(text));

    if (found === undefined) {
      throw new Error(`No row of ${list} reads ${text}`);
    }

    return found;
  };

  /** Submits the form, as the Start Download button does. */
  const start = async (wrapper: VueWrapper) => {
    await wrapper.get('form').trigger('submit');
  };

  const list = async (wrapper: VueWrapper, address: string) => {
    await inputs(wrapper)[0].setValue(address);
    await vi.advanceTimersByTimeAsync(Config.LIST_DEBOUNCE_MS + 1);
    await flushPromises();
  };

  const tick = async (wrapper: VueWrapper, list: ChecklistTestId, text: string) => {
    await row(wrapper, list, text).get('input').setValue(true);
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();

    getRepositoryListing.mockResolvedValue(listing());
    createDownload.mockResolvedValue({});
    getNodeList.mockResolvedValue({
      nodeList: [
        { id: 1, name: 'rig-01', state: NodeState.ONLINE, enabled: true, lastSeenDate: null, agentVersion: null },
        { id: 2, name: 'rig-02', state: NodeState.ONLINE, enabled: true, lastSeenDate: null, agentVersion: null },
      ],
      pages: 1,
    });
    streamFleetTelemetry.mockImplementation((callback: (response: FleetTelemetryResponseDto) => void) => {
      onFleet = callback;

      return { close: vi.fn() };
    });
    push.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('asks for a source before it lists anything', async () => {
    const wrapper = await render();

    expect(wrapper.text()).toContain('Enter a repository to see its files.');
    expect(getRepositoryListing).not.toHaveBeenCalled();
  });

  it('lists a pasted address once, at the revision it names, with nothing ticked and the commit shown', async () => {
    const wrapper = await render();

    await list(wrapper, 'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/v1.0');

    expect(getRepositoryListing).toHaveBeenCalledTimes(1);
    expect(getRepositoryListing).toHaveBeenCalledWith({ repository: 'unsloth/Qwen3-0.6B-GGUF', revision: 'v1.0' });
    expect(rows(wrapper, 'download-files')).toHaveLength(3);
    expect(wrapper.find('[data-testid="download-selected"]').text()).toBe('None selected · 50968a4');
  });

  it('selects every file from the list head and clears them again', async () => {
    const wrapper = await render();

    await list(wrapper, 'unsloth/Qwen3-0.6B-GGUF');

    const selectAll = () => wrapper.get('[data-testid="download-files"] label').get('input');

    await selectAll().setValue(true);

    expect(wrapper.find('[data-testid="download-selected"]').text()).toContain('3 of 3 selected · 9 GiB');

    await selectAll().setValue(false);

    expect(wrapper.find('[data-testid="download-selected"]').text()).toContain('None selected');
  });

  it('marks the list head part-ticked while only some files are', async () => {
    const wrapper = await render();

    await list(wrapper, 'unsloth/Qwen3-0.6B-GGUF');
    await tick(wrapper, 'download-files', 'README.md');

    const selectAll = wrapper.get('[data-testid="download-files"] label').get('input');

    expect(selectAll.attributes('aria-checked')).toBe('mixed');
    expect(wrapper.find('[data-testid="download-selected"]').text()).toContain('1 of 3 selected');
  });

  it('lists the source straight away on Enter, without starting the download', async () => {
    const wrapper = await render();

    await inputs(wrapper)[0].setValue('unsloth/Qwen3-0.6B-GGUF');
    await inputs(wrapper)[0].trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(getRepositoryListing).toHaveBeenCalledTimes(1);
    expect(createDownload).not.toHaveBeenCalled();
  });

  it('says why a repo could not be listed in place of its files', async () => {
    getRepositoryListing.mockRejectedValue(new Error('owner/nope does not exist, or is private'));

    const wrapper = await render();

    await list(wrapper, 'owner/nope');

    expect(wrapper.get('[data-testid="download-files"]').text()).toContain('owner/nope does not exist, or is private');
    expect(rows(wrapper, 'download-files')).toHaveLength(0);
  });

  it('says in place of the files why the Hub could not be read, where the server keys it to the repository', async () => {
    getRepositoryListing.mockRejectedValue(
      new ValidationError(null, { repository: { name: 'Repository', message: 'https://hub.test could not be read' } })
    );

    const wrapper = await render();

    await list(wrapper, 'owner/repo');

    expect(wrapper.get('[data-testid="download-files"]').text()).toContain('https://hub.test could not be read');
  });

  it('shows a refusal of the start keyed to the repository under the source', async () => {
    const wrapper = await render();

    useErrorStore().setValidationError(
      new ValidationError('create-download', {
        repository: { name: 'Repository', message: 'https://hub.test could not be read' },
      })
    );
    await flushPromises();

    expect(wrapper.findAll('[data-testid="field-error"]').map(error => error.text())).toEqual([
      'https://hub.test could not be read',
    ]);
  });

  it('starts the download at the commit it listed, with the ticked files and the prefilled destination', async () => {
    const wrapper = await render();

    await list(wrapper, 'unsloth/qwen3-0.6b-gguf');
    await tick(wrapper, 'download-files', 'README.md');
    await tick(wrapper, 'download-files', 'Q4_K_M');
    await tick(wrapper, 'download-nodes', 'rig-01');
    await tick(wrapper, 'download-nodes', 'rig-02');
    await start(wrapper);
    await flushPromises();

    expect(createDownload).toHaveBeenCalledWith(
      {
        repository: 'unsloth/Qwen3-0.6B-GGUF',
        revision: COMMIT,
        directory: 'huggingface/unsloth/Qwen3-0.6B-GGUF',
        files: ['Qwen3-0.6B-Q4_K_M.gguf', 'README.md'],
        nodeIds: [1, 2],
      },
      'create-download'
    );
  });

  it('drops the listing and its ticks when the repository changes, so nothing starts from a stale one', async () => {
    const wrapper = await render();

    await list(wrapper, 'unsloth/Qwen3-0.6B-GGUF');
    await tick(wrapper, 'download-files', 'README.md');
    await inputs(wrapper)[0].setValue('owner/other');

    expect(rows(wrapper, 'download-files')).toHaveLength(0);
  });

  it('clears a revision an address filled in once the address names none, and keeps one the operator typed', async () => {
    const wrapper = await render();

    await inputs(wrapper)[0].setValue('https://huggingface.co/a/b/tree/dev');

    expect(inputs(wrapper)[1].element.value).toBe('dev');

    await inputs(wrapper)[0].setValue('https://huggingface.co/c/d');

    expect(inputs(wrapper)[1].element.value).toBe('');

    await inputs(wrapper)[1].setValue('v2');
    await inputs(wrapper)[0].setValue('e/f');

    expect(inputs(wrapper)[1].element.value).toBe('v2');
  });

  it('marks a node the ticked files will not fit, as the node last reported, and never blocks the start', async () => {
    const wrapper = await render();

    onFleet(
      fleet([
        [1, host(10 * GIB)],
        [2, host(4 * GIB)],
      ])
    );
    await list(wrapper, 'unsloth/Qwen3-0.6B-GGUF');
    await tick(wrapper, 'download-files', 'Q8_0');
    await tick(wrapper, 'download-nodes', 'rig-02');

    expect(row(wrapper, 'download-nodes', 'rig-01').text()).toContain('10 GiB free');
    expect(row(wrapper, 'download-nodes', 'rig-02').text()).toContain('4 GiB free · needs 6 GiB');

    await start(wrapper);
    await flushPromises();

    expect(createDownload).toHaveBeenCalledWith(expect.objectContaining({ nodeIds: [2] }), 'create-download');
  });

  it('counts the ticked nodes, and ticks every node from Select all', async () => {
    const wrapper = await render();
    const summary = () => wrapper.get('[data-testid="download-nodes"] [data-testid="picker-summary"]').text();

    expect(summary()).toBe('None selected');

    await tick(wrapper, 'download-nodes', 'rig-01');

    expect(summary()).toBe('1 of 2 selected');

    await wrapper.get('[data-testid="download-nodes"] label').get('input').setValue(true);

    expect(summary()).toBe('2 of 2 selected');
  });

  it('reads an offline node as offline rather than by a free space it last reported', async () => {
    getNodeList.mockResolvedValue({
      nodeList: [
        { id: 3, name: 'rig-03', state: NodeState.OFFLINE, enabled: true, lastSeenDate: null, agentVersion: null },
      ],
      pages: 1,
    });

    const wrapper = await render();

    onFleet(fleet([[3, host(10 * GIB)]]));
    await flushPromises();

    expect(row(wrapper, 'download-nodes', 'rig-03').text()).toContain('Offline');
  });

  it('warns once more files are ticked than one download can name', async () => {
    getRepositoryListing.mockResolvedValue(listing({ maxFilesPerDownload: 2 }));

    const wrapper = await render();

    await list(wrapper, 'unsloth/Qwen3-0.6B-GGUF');
    await tick(wrapper, 'download-files', 'Q4_K_M');
    await tick(wrapper, 'download-files', 'Q8_0');

    expect(wrapper.text()).not.toContain('A download names at most 2 files');

    await tick(wrapper, 'download-files', 'README.md');

    expect(wrapper.text()).toContain('A download names at most 2 files');
  });

  it('refuses an address that names no model repository without asking the server', async () => {
    const wrapper = await render();

    await list(wrapper, 'https://huggingface.co/datasets/owner/data');

    expect(getRepositoryListing).not.toHaveBeenCalled();
  });
});
