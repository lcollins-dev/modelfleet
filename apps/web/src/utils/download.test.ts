import { describe, expect, it } from 'vitest';

import type { DownloadDto, DownloadTargetDto, ModelDirectorySpaceDto, NodeHostTelemetryDto } from '@libs/dto';
import {
  DownloadFileState,
  DownloadProgressState,
  DownloadSource,
  DownloadState,
  DownloadTargetState,
  ModelDirectoryWriteAccess,
  NodeState,
} from '@libs/dto';

import {
  describeDownloadTarget,
  downloadPercent,
  downloadStateBar,
  formatDownloadAmount,
  formatDownloadSpeed,
  formatDownloadTimeLeft,
  defaultDownloadDirectory,
  describeDownloadSpace,
  parseRepositoryAddress,
  selectedBytes,
  summariseDownload,
  withProgress,
} from './download';

const GIB = 1024 ** 3;

const buildTarget = (overrides: Partial<DownloadTargetDto> = {}): DownloadTargetDto => ({
  nodeId: 1,
  nodeName: 'gpu-01',
  nodeState: NodeState.ONLINE,
  state: DownloadTargetState.ACTIVE,
  progress: null,
  message: null,
  bytesDone: 0,
  totalBytes: 10 * GIB,
  bytesPerSecond: null,
  files: [],
  settledDate: null,
  ...overrides,
});

const buildDownload = (state: DownloadState, targets: DownloadTargetDto[]): DownloadDto => ({
  id: 1,
  key: 'download-key',
  directory: 'huggingface/owner/repo',
  source: DownloadSource.HUGGINGFACE,
  repository: 'owner/repo',
  revision: 'a'.repeat(40),
  state,
  files: [],
  targets,
  bytesDone: 0,
  totalBytes: 0,
  createdDate: new Date('2026-09-26T09:14:00.000Z'),
});

describe('summariseDownload', () => {
  it('names the node where there is only one', () => {
    expect(summariseDownload(buildDownload(DownloadState.ACTIVE, [buildTarget()]))).toBe('Downloading to gpu-01');
  });

  it('says how many of the nodes share the outcome where they do not all', () => {
    const download = buildDownload(DownloadState.FAILED, [
      buildTarget({ state: DownloadTargetState.SUCCEEDED }),
      buildTarget({ nodeId: 2, state: DownloadTargetState.FAILED }),
    ]);

    expect(summariseDownload(download)).toBe('Failed on 1 of 2 nodes');
  });
});

describe('describeDownloadTarget', () => {
  it('leaves a target whose bytes move to its speed and time left', () => {
    const target = buildTarget({
      progress: DownloadProgressState.DOWNLOADING,
      bytesDone: 4 * GIB,
      bytesPerSecond: 100 * 1024 * 1024,
    });

    expect(describeDownloadTarget(target)).toBeNull();
    expect(formatDownloadSpeed(target)).toBe('100 MiB/s');
    expect(formatDownloadTimeLeft(target)).toBe('1m 1s');
  });

  it('reads a node queued behind another download as such, with no speed', () => {
    const target = buildTarget({ progress: DownloadProgressState.QUEUED });

    expect(describeDownloadTarget(target)).toBe('Queued behind another download on this node');
    expect(formatDownloadSpeed(target)).toBe('-');
    expect(formatDownloadTimeLeft(target)).toBe('-');
  });

  it('reads an active target the node has not reported on as waiting for it', () => {
    expect(describeDownloadTarget(buildTarget())).toBe('Waiting for the node to report');
  });

  it('gives the reason a node failed', () => {
    const target = buildTarget({
      state: DownloadTargetState.FAILED,
      message: 'The disk filled while writing model.gguf',
    });

    expect(describeDownloadTarget(target)).toBe('The disk filled while writing model.gguf');
  });
});

describe('downloadStateBar', () => {
  it('fills an active download in the brand tone and a stopped one muted', () => {
    expect(downloadStateBar(DownloadState.ACTIVE)).toBe('primary');
    expect(downloadStateBar(DownloadState.COMPLETED)).toBe('success');
    expect(downloadStateBar(DownloadState.FAILED)).toBe('error');
    expect(downloadStateBar(DownloadState.STOPPED)).toBe('muted');
  });
});

describe('downloadPercent', () => {
  it('holds at 99 until the last byte arrives', () => {
    expect(downloadPercent(999_999, 1_000_000)).toBe(99);
    expect(downloadPercent(1_000_000, 1_000_000)).toBe(100);
  });
});

describe('formatDownloadAmount', () => {
  it('reads bytes done against the total, with the share done', () => {
    expect(formatDownloadAmount(5 * GIB, 10 * GIB)).toBe('5 GiB / 10 GiB (50%)');
  });
});

describe('parseRepositoryAddress', () => {
  it.each([
    ['unsloth/Qwen3-0.6B-GGUF', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['  unsloth/Qwen3-0.6B-GGUF ', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['https://huggingface.co/unsloth/Qwen3-0.6B-GGUF', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['huggingface.co/unsloth/Qwen3-0.6B-GGUF', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['https://hf.co/unsloth/Qwen3-0.6B-GGUF?library=llama.cpp#files', 'unsloth/Qwen3-0.6B-GGUF', null],
    ['https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/main', 'unsloth/Qwen3-0.6B-GGUF', 'main'],
    [
      'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/blob/v1.0/Qwen3-0.6B-Q8_0.gguf',
      'unsloth/Qwen3-0.6B-GGUF',
      'v1.0',
    ],
    ['https://huggingface.co/owner/repo/resolve/refs%2Fpr%2F1/model.gguf', 'owner/repo', 'refs/pr/1'],
    ['https://huggingface.co/owner/repo/discussions', 'owner/repo', null],
  ])('reads %j as %s at %s', (input, repository, revision) => {
    expect(parseRepositoryAddress(input)).toEqual({ repository, revision });
  });

  it.each([
    '',
    'Qwen3-0.6B-GGUF',
    'owner/repo/extra',
    'owner//repo',
    'https://huggingface.co/unsloth',
    'https://huggingface.co/datasets/owner/data',
    'https://huggingface.co/spaces/owner/app',
    'https://huggingface.co/settings/tokens',
    'https://github.com/owner/repo',
    'https://huggingface.co/owner/%E0%A4%A',
  ])('reads %j as no repository', input => {
    expect(parseRepositoryAddress(input)).toBeNull();
  });
});

describe('selectedBytes', () => {
  it('totals the ticked files alone', () => {
    const files = [
      { path: 'a.gguf', sizeBytes: 3 * GIB },
      { path: 'b.gguf', sizeBytes: 5 * GIB },
      { path: 'README.md', sizeBytes: 1024 },
    ];

    expect(selectedBytes(files, ['a.gguf', 'README.md'])).toBe(3 * GIB + 1024);
    expect(selectedBytes(files, [])).toBe(0);
  });
});

describe('describeDownloadSpace', () => {
  const host = (modelDirectories: ModelDirectorySpaceDto[]): NodeHostTelemetryDto => ({
    cpuModel: null,
    cpuCount: 8,
    loadAverage1m: null,
    memoryTotalBytes: 32 * GIB,
    memoryFreeBytes: 16 * GIB,
    modelDirectories,
  });

  const directory = (overrides: Partial<ModelDirectorySpaceDto> = {}): ModelDirectorySpaceDto => ({
    path: '/models',
    freeBytes: 10 * GIB,
    totalBytes: 100 * GIB,
    writeAccess: ModelDirectoryWriteAccess.WRITABLE,
    ...overrides,
  });

  it('reads room against the first model directory, where downloads land', () => {
    const space = describeDownloadSpace(host([directory(), directory({ path: '/bulk', freeBytes: 1 * GIB })]), 4 * GIB);

    expect(space).toEqual({ warns: false, text: '10 GiB free' });
  });

  it('marks a node where the ticked files will not fit, saying both figures', () => {
    const space = describeDownloadSpace(host([directory({ freeBytes: 2 * GIB })]), 4 * GIB);

    expect(space).toEqual({ warns: true, text: '2 GiB free · needs 4 GiB' });
  });

  it('fits exactly the free space', () => {
    expect(describeDownloadSpace(host([directory({ freeBytes: GIB })]), GIB).warns).toBe(false);
  });

  it.each([
    ['a node that has not reported', null],
    ['an agent that predates reporting it', host([])],
  ])('reads %s as unknown rather than as full', (_label, reported) => {
    expect(describeDownloadSpace(reported, GIB)).toEqual({ warns: false, text: 'Free space unknown' });
  });

  it('reads a directory the node could not measure as unknown', () => {
    const space = describeDownloadSpace(host([directory({ freeBytes: null, totalBytes: null })]), GIB);

    expect(space).toEqual({ warns: false, text: 'Free space unknown' });
  });

  it.each([
    [ModelDirectoryWriteAccess.READ_ONLY, 'Read-only · 10 GiB free'],
    [ModelDirectoryWriteAccess.DENIED, 'Not writable by the agent · 10 GiB free'],
  ])('marks a node whose model directory is %s, naming why, even with room to spare', (writeAccess, text) => {
    expect(describeDownloadSpace(host([directory({ writeAccess })]), GIB)).toEqual({ warns: true, text });
  });

  it('names both the refusal and the shortfall where a directory has both', () => {
    const space = describeDownloadSpace(
      host([directory({ freeBytes: GIB, writeAccess: ModelDirectoryWriteAccess.READ_ONLY })]),
      4 * GIB
    );

    expect(space).toEqual({ warns: true, text: 'Read-only · 1 GiB free · needs 4 GiB' });
  });

  it('reads a directory whose write access is unknown by its free space alone', () => {
    expect(describeDownloadSpace(host([directory({ writeAccess: null })]), GIB)).toEqual({
      warns: false,
      text: '10 GiB free',
    });
  });
});

describe('withProgress', () => {
  it('lays live bytes over an active target and sums them for the download', () => {
    const download = buildDownload(DownloadState.ACTIVE, [
      buildTarget({ bytesDone: 0, files: [{ path: 'model.gguf', state: DownloadFileState.PENDING, bytesDone: 0 }] }),
      buildTarget({ nodeId: 2, state: DownloadTargetState.SUCCEEDED, bytesDone: 10 * GIB }),
    ]);

    const merged = withProgress(download, {
      key: 'download-key',
      targets: [
        {
          nodeId: 1,
          progress: DownloadProgressState.DOWNLOADING,
          bytesDone: 3 * GIB,
          bytesPerSecond: 1024,
          files: [{ path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 3 * GIB }],
        },
        { nodeId: 2, progress: DownloadProgressState.DOWNLOADING, bytesDone: 1, bytesPerSecond: 1, files: [] },
      ],
    });

    expect(merged.targets[0]).toMatchObject({
      bytesDone: 3 * GIB,
      bytesPerSecond: 1024,
      files: [{ path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 3 * GIB }],
    });
    expect(merged.targets[1].bytesDone).toBe(10 * GIB);
    expect(merged.bytesDone).toBe(13 * GIB);
  });

  it('keeps the files in the order the download names them, not the order the node fetches them', () => {
    const pending = (path: string) => ({ path, state: DownloadFileState.PENDING, bytesDone: 0 });
    const download = buildDownload(DownloadState.ACTIVE, [
      buildTarget({ files: [pending('config.json'), pending('model.safetensors')] }),
    ]);

    const merged = withProgress(download, {
      key: 'download-key',
      targets: [
        {
          nodeId: 1,
          progress: DownloadProgressState.DOWNLOADING,
          bytesDone: 5,
          bytesPerSecond: null,
          files: [
            { path: 'model.safetensors', state: DownloadFileState.DOWNLOADING, bytesDone: 5 },
            pending('config.json'),
          ],
        },
      ],
    });

    expect(merged.targets[0].files.map(file => file.path)).toEqual(['config.json', 'model.safetensors']);
    expect(merged.targets[0].files[1].bytesDone).toBe(5);
  });
});

describe('defaultDownloadDirectory', () => {
  it('lands a repository under huggingface, and names nothing until a repository is typed', () => {
    expect(defaultDownloadDirectory(' owner/repo ')).toBe('huggingface/owner/repo');
    expect(defaultDownloadDirectory('')).toBe('');
  });
});
