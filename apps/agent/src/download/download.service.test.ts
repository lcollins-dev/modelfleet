import { mkdir, mkdtemp, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DesiredDownload,
  DesiredDownloadFile,
  DownloadDigestAlgorithm,
  DownloadFileState,
  DownloadSource,
  DownloadState,
  ObservedDownload,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { DownloadLocationService } from '@/download/download-location.service';
import { DownloadService } from '@/download/download.service';
import { FetchProgress, FileFetcherService } from '@/download/file-fetcher.service';
import { DownloadError } from '@/download/types/errors';
import { IFileLocation } from '@/download/types/file-location';
import { ModelService } from '@/model/model.service';

const DOWNLOAD_KEY = '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';

function fileOf(path: string, sizeBytes = 100): DesiredDownloadFile {
  return { path, sizeBytes, digest: { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) } };
}

function downloadOf(files: DesiredDownloadFile[], downloadKey = DOWNLOAD_KEY, attempt = 0): DesiredDownload {
  return {
    downloadKey,
    attempt,
    source: DownloadSource.HUGGINGFACE,
    endpoint: 'https://hub.test',
    repository: 'owner/repo',
    directory: 'huggingface/owner/repo',
    revision: 'a'.repeat(40),
    files,
  };
}

describe('DownloadService', () => {
  let modelDirectory: string;
  let downloadService: DownloadService;
  let fetchMock: ReturnType<typeof vi.fn<FileFetcherService['fetch']>>;
  let isHeldMock: ReturnType<typeof vi.fn<FileFetcherService['isHeld']>>;
  let partialBytesMock: ReturnType<typeof vi.fn<FileFetcherService['partialBytes']>>;
  let requestScan: ReturnType<typeof vi.fn>;
  let modelDirs: string[];

  beforeEach(async () => {
    modelDirectory = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-downloads-')));
    modelDirs = [modelDirectory];

    fetchMock = vi.fn<FileFetcherService['fetch']>().mockResolvedValue(undefined);
    isHeldMock = vi.fn<FileFetcherService['isHeld']>().mockResolvedValue(false);
    partialBytesMock = vi.fn<FileFetcherService['partialBytes']>().mockResolvedValue(0);
    requestScan = vi.fn();

    const configService = {
      get modelDirs() {
        return modelDirs;
      },
    } as unknown as ConfigService;
    const fileFetcherService = {
      fetch: fetchMock,
      isHeld: isHeldMock,
      partialBytes: partialBytesMock,
    } as unknown as FileFetcherService;

    downloadService = new DownloadService(new DownloadLocationService(configService), fileFetcherService, {
      requestScan,
    } as unknown as ModelService);
  });

  afterEach(async () => {
    downloadService.onModuleDestroy();

    await rm(modelDirectory, { recursive: true, force: true });
  });

  function reported(downloadKey = DOWNLOAD_KEY): ObservedDownload | undefined {
    return downloadService.currentProgress().downloads.find(download => download.downloadKey === downloadKey);
  }

  async function settled(downloadKey = DOWNLOAD_KEY): Promise<ObservedDownload> {
    return vi.waitFor(() => {
      const download = reported(downloadKey);

      if (download?.state !== DownloadState.SUCCEEDED && download?.state !== DownloadState.FAILED) {
        throw new Error('The download has not settled');
      }

      return download;
    });
  }

  function repositoryPath(...segments: string[]): string {
    return join(modelDirectory, 'huggingface', 'owner', 'repo', ...segments);
  }

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false
    );
  }

  it('writes under the first model directory, beneath the source and the repository', async () => {
    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('sub/model.gguf')])] });
    await settled();

    const location: IFileLocation = fetchMock.mock.calls[0][2];

    expect(location.filePath).toBe(repositoryPath('sub', 'model.gguf'));
    expect(location.partialPath).toBe(repositoryPath('sub', 'model.gguf.part'));
  });

  it('fetches config.json last, so a partly fetched directory never reads as a whole model', async () => {
    const files = [fileOf('config.json'), fileOf('model-00001-of-00002.safetensors'), fileOf('tokenizer.json')];

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf(files)] });
    await settled();

    expect(fetchMock.mock.calls.map(call => call[1].path)).toEqual([
      'model-00001-of-00002.safetensors',
      'tokenizer.json',
      'config.json',
    ]);
  });

  it('reports a file already held as held, fetches only the rest, and succeeds', async () => {
    isHeldMock.mockImplementation(file => Promise.resolve(file.path === 'held.gguf'));

    await downloadService.applyDesiredDownloads({
      downloads: [downloadOf([fileOf('held.gguf'), fileOf('new.gguf')])],
    });

    const download = await settled();

    expect(download.state).toBe(DownloadState.SUCCEEDED);
    expect(download.files).toEqual([
      { path: 'held.gguf', state: DownloadFileState.HELD, bytesDone: 100 },
      { path: 'new.gguf', state: DownloadFileState.DONE, bytesDone: 100 },
    ]);
    expect(fetchMock.mock.calls.map(call => call[1].path)).toEqual(['new.gguf']);
  });

  it('counts neither a held file nor what a partial already holds against the free space', async () => {
    const huge = 2 ** 53 - 1;

    isHeldMock.mockImplementation(file => Promise.resolve(file.path === 'held.gguf'));
    partialBytesMock.mockImplementation(file => Promise.resolve(file.path === 'resumed.gguf' ? huge - 1 : 0));

    await downloadService.applyDesiredDownloads({
      downloads: [downloadOf([fileOf('held.gguf', huge), fileOf('resumed.gguf', huge)])],
    });

    expect((await settled()).state).toBe(DownloadState.SUCCEEDED);
  });

  it('leaves a held file and one it finished in place when a later file fails', async () => {
    await mkdir(repositoryPath(), { recursive: true });
    await writeFile(repositoryPath('held.gguf'), 'placed by hand');

    isHeldMock.mockImplementation(file => Promise.resolve(file.path === 'held.gguf'));
    fetchMock.mockImplementation(async (_download, file, location) => {
      if (file.path === 'first.gguf') {
        await writeFile(location.filePath, 'finished');

        return;
      }

      throw new DownloadError('The source answered 404');
    });

    await downloadService.applyDesiredDownloads({
      downloads: [downloadOf([fileOf('held.gguf'), fileOf('first.gguf'), fileOf('second.gguf')])],
    });

    expect((await settled()).state).toBe(DownloadState.FAILED);
    expect(await exists(repositoryPath('held.gguf'))).toBe(true);
    expect(await exists(repositoryPath('first.gguf'))).toBe(true);
  });

  it('fails before fetching anything when the disk cannot hold what is left to fetch', async () => {
    const tooLarge = 2 ** 53 - 1;

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('huge.gguf', tooLarge)])] });

    const download = await settled();

    expect(download.state).toBe(DownloadState.FAILED);
    expect(download.message).toMatch(/owner\/repo needs .* GiB but .* has .* GiB free/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails, naming the reason, and removes what it partly wrote', async () => {
    fetchMock.mockImplementation(async (_download, _file, location) => {
      await mkdir(join(location.partialPath, '..'), { recursive: true });
      await writeFile(location.partialPath, 'partial');

      throw new DownloadError('model.gguf did not match the digest the Hub records for it, so it was discarded');
    });

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    const download = await settled();

    expect(download.state).toBe(DownloadState.FAILED);
    expect(download.message).toContain('did not match the digest');
    expect(download.files[0].state).toBe(DownloadFileState.FAILED);
    expect(await exists(repositoryPath('model.gguf.part'))).toBe(false);
  });

  it('fails where the node has no model directory to write into', async () => {
    downloadService = new DownloadService(
      new DownloadLocationService({ modelDirs: [] } as unknown as ConfigService),
      { fetch: fetchMock, isHeld: isHeldMock, partialBytes: vi.fn() } as unknown as FileFetcherService,
      { requestScan } as unknown as ModelService
    );

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    expect((await settled()).message).toBe('This node has no model directory configured to download into');
  });

  it('asks for a scan once a download settles, so what landed is catalogued', async () => {
    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
    await settled();

    await vi.waitFor(() => {
      expect(requestScan).toHaveBeenCalled();
    });
  });

  it('stops a download the server drops, removing its partial files and forgetting it', async () => {
    fetchMock.mockImplementation(async (_download, _file, location, signal) => {
      await mkdir(join(location.partialPath, '..'), { recursive: true });
      await writeFile(location.partialPath, 'partial');

      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    await downloadService.applyDesiredDownloads({ downloads: [] });

    await vi.waitFor(async () => {
      expect(await exists(repositoryPath('model.gguf.part'))).toBe(false);
    });
    expect(reported()).toBeUndefined();
  });

  it('leaves a partial on disk to resume from when the agent itself stops', async () => {
    fetchMock.mockImplementation(async (_download, _file, location, signal) => {
      await mkdir(join(location.partialPath, '..'), { recursive: true });
      await writeFile(location.partialPath, 'partial');

      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    downloadService.onModuleDestroy();
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(await exists(repositoryPath('model.gguf.part'))).toBe(true);
  });

  it('removes the partials of a download dropped before its turn came', async () => {
    const second = '7f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';
    const waiting = repositoryPath('waiting.gguf.part');
    const first = downloadOf([fileOf('first.gguf')]);

    fetchMock.mockImplementation(() => new Promise(() => undefined));

    await mkdir(repositoryPath(), { recursive: true });
    await writeFile(waiting, 'left from before a restart');

    await downloadService.applyDesiredDownloads({ downloads: [first, downloadOf([fileOf('waiting.gguf')], second)] });
    expect(await exists(waiting)).toBe(true);

    await downloadService.applyDesiredDownloads({ downloads: [first] });

    expect(await exists(waiting)).toBe(false);
  });

  it('holds a failure message to the length the report can carry', async () => {
    fetchMock.mockRejectedValue(new DownloadError(`A different file is already at /${'a'.repeat(600)}`));

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    const message = (await settled()).message ?? '';

    expect(message).toHaveLength(512);
    expect(message.endsWith('...')).toBe(true);
  });

  it('keeps a settled download, and reports it, until the server drops it', async () => {
    const downloads = [downloadOf([fileOf('model.gguf')])];

    await downloadService.applyDesiredDownloads({ downloads });
    await settled();

    await downloadService.applyDesiredDownloads({ downloads });

    expect(reported()?.state).toBe(DownloadState.SUCCEEDED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts a settled download again when the server asks for a new attempt', async () => {
    fetchMock.mockRejectedValueOnce(new DownloadError('The disk filled'));

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
    expect((await settled()).state).toBe(DownloadState.FAILED);

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')], DOWNLOAD_KEY, 1)] });

    await vi.waitFor(() => {
      expect(reported()).toMatchObject({ attempt: 1, state: DownloadState.SUCCEEDED });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('carries on with a download still under way when the server asks for a new attempt', async () => {
    let release: () => void = () => undefined;

    fetchMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')], DOWNLOAD_KEY, 1)] });
    release();

    expect(await settled()).toMatchObject({ attempt: 1, state: DownloadState.SUCCEEDED });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches the rest of a download under way with the token the latest set carries', async () => {
    let release: () => void = () => undefined;
    const files = [fileOf('model.gguf'), fileOf('config.json')];

    fetchMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );

    await downloadService.applyDesiredDownloads({ downloads: [{ ...downloadOf(files), token: 'hf_revoked' }] });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    await downloadService.applyDesiredDownloads({ downloads: [{ ...downloadOf(files), token: 'hf_rotated' }] });
    release();
    await settled();

    expect(fetchMock.mock.calls[1][0].token).toBe('hf_rotated');
  });

  it('keeps a wanted partial under a model directory configured as a relative path', async () => {
    const wanted = repositoryPath('model.gguf.part');

    modelDirs = [relative(process.cwd(), modelDirectory)];
    await mkdir(repositoryPath(), { recursive: true });
    await writeFile(wanted, 'resumable');
    fetchMock.mockImplementation(() => new Promise(() => undefined));

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    expect(await exists(wanted)).toBe(true);
  });

  it('applies a set only once the one before has finished, so its sweep never reaches a newer download', async () => {
    fetchMock.mockImplementation(async (_download, _file, location) => {
      await mkdir(join(location.partialPath, '..'), { recursive: true });
      await writeFile(location.partialPath, 'being written');

      await new Promise(() => undefined);
    });

    const first = downloadService.applyDesiredDownloads({ downloads: [] });
    const second = downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    await Promise.all([first, second]);
    await vi.waitFor(async () => {
      expect(await exists(repositoryPath('model.gguf.part'))).toBe(true);
    });
  });

  it('leaves alone a partial that a symlinked directory carries out of the model directory', async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'modelfleet-outside-')));

    try {
      await mkdir(join(modelDirectory, 'huggingface', 'owner'), { recursive: true });
      await symlink(outside, repositoryPath());
      await writeFile(join(outside, 'model.gguf.part'), "not the agent's");

      await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });
      await settled();

      expect(await exists(join(outside, 'model.gguf.part'))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('leaves a file it finished in place when the server stops the download', async () => {
    fetchMock.mockImplementationOnce(async (_download, _file, location) => {
      await mkdir(join(location.filePath, '..'), { recursive: true });
      await writeFile(location.filePath, 'finished');
    });
    fetchMock.mockImplementationOnce(async (_download, _file, location, signal) => {
      await writeFile(location.partialPath, 'partial');

      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });

    await downloadService.applyDesiredDownloads({
      downloads: [downloadOf([fileOf('first.gguf'), fileOf('second.gguf')])],
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    await downloadService.applyDesiredDownloads({ downloads: [] });

    await vi.waitFor(async () => {
      expect(await exists(repositoryPath('second.gguf.part'))).toBe(false);
    });
    expect(await exists(repositoryPath('first.gguf'))).toBe(true);
  });

  it('removes a partial no wanted file maps to, and keeps one that a wanted file does', async () => {
    const orphan = repositoryPath('dropped.gguf.part');
    const wanted = repositoryPath('model.gguf.part');

    await mkdir(repositoryPath(), { recursive: true });
    await writeFile(orphan, 'left by a download stopped while the agent was down');
    await writeFile(wanted, 'resumable');

    fetchMock.mockImplementation(() => new Promise(() => undefined));

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    expect(await exists(orphan)).toBe(false);
    expect(await exists(wanted)).toBe(true);
  });

  it('works through downloads one at a time, in the order the server sent them', async () => {
    const second = '7f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';
    let release: () => void = () => undefined;

    fetchMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );

    await downloadService.applyDesiredDownloads({
      downloads: [downloadOf([fileOf('first.gguf')]), downloadOf([fileOf('second.gguf')], second)],
    });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(reported(second)?.state).toBe(DownloadState.QUEUED);

    release();

    expect((await settled(second)).state).toBe(DownloadState.SUCCEEDED);
  });

  it('reports what the fetch says it is doing as the file progresses', async () => {
    fetchMock.mockImplementation((_download, _file, _location, _signal, onProgress: FetchProgress) => {
      onProgress(DownloadFileState.DOWNLOADING, 40);

      return new Promise(() => undefined);
    });

    await downloadService.applyDesiredDownloads({ downloads: [downloadOf([fileOf('model.gguf')])] });

    await vi.waitFor(() => {
      expect(reported()?.files[0]).toEqual({ path: 'model.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 40 });
    });
    expect(reported()?.state).toBe(DownloadState.DOWNLOADING);
  });
});
