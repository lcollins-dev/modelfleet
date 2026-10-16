import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DesiredDownload,
  DesiredDownloadFile,
  DownloadDigestAlgorithm,
  DownloadFileState,
  DownloadSource,
} from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { FileDigestService } from '@/download/file-digest.service';
import { FetchProgress, FileFetcherService } from '@/download/file-fetcher.service';
import { DownloadError } from '@/download/types/errors';
import { IFileLocation } from '@/download/types/file-location';

/** Set to a filesystem error code to make every write through `open` fail with it. */
const writeFailure = vi.hoisted(() => ({ code: null as string | null }));

/** Set to a filesystem error code to make every `access` check fail with it. */
const accessFailure = vi.hoisted(() => ({ code: null as string | null }));

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    access: async (...args: Parameters<typeof actual.access>) => {
      const code = accessFailure.code;

      if (code === null) {
        return actual.access(...args);
      }

      throw Object.assign(new Error(`${code}: access '${String(args[0])}'`), {
        code,
        syscall: 'access',
        path: String(args[0]),
      });
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const code = writeFailure.code;

      if (code === null) {
        return handle;
      }

      return {
        write: () => Promise.reject(Object.assign(new Error(`${code}: write`), { code })),
        close: () => handle.close(),
      };
    },
  };
});

const CONTENT = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz'.repeat(4));

const FILE_URL = 'https://hub.test/files/model.gguf?signed=1';

const FILE: DesiredDownloadFile = {
  path: 'model.gguf',
  url: FILE_URL,
  sizeBytes: CONTENT.length,
  digest: { algorithm: DownloadDigestAlgorithm.SHA256, value: createHash('sha256').update(CONTENT).digest('hex') },
};

const DOWNLOAD: DesiredDownload = {
  downloadKey: '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f',
  attempt: 0,
  source: DownloadSource.HUGGINGFACE,
  endpoint: 'https://hub.test/',
  repository: 'owner/repo',
  directory: 'huggingface/owner/repo',
  revision: 'a'.repeat(40),
  files: [FILE],
};

const TOKEN = 'hf_fleetToken123';

const CONFIG = {
  downloadStallTimeout: '200ms',
  downloadStallTimeoutMs: 200,
  downloadRetryLimit: 3,
  downloadRetryBackoff: { initialDelayMs: 1, maxDelayMs: 1, jitterRatio: 0.2 },
} as unknown as ConfigService;

/** Sends `bytes` and then, where asked, drops the connection instead of ending. */
function bodyOf(bytes: Buffer, drop = false): ReadableStream<Uint8Array> {
  let sent = false;

  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true;
        controller.enqueue(new Uint8Array(bytes));
      } else if (drop) {
        controller.error(new TypeError('terminated'));
      } else {
        controller.close();
      }
    },
  });
}

/** Sends nothing until the fetch is aborted, as a real body does once its signal fires. */
function silent(init: RequestInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
    },
  });

  return new Response(body, { status: 200 });
}

function whole(): Response {
  return new Response(bodyOf(CONTENT), { status: 200 });
}

function range(from: number, drop = false, start = from): Response {
  return new Response(bodyOf(CONTENT.subarray(from), drop), {
    status: 206,
    headers: new Headers([['content-range', `bytes ${start}-${CONTENT.length - 1}/${CONTENT.length}`]]),
  });
}

function headersOf(call: unknown[]): Record<string, string> {
  return (call[1] as RequestInit).headers as Record<string, string>;
}

function rangeHeaderOf(call: unknown[]): string | undefined {
  return headersOf(call).Range;
}

/** `fetch` counts two hosts as two origins, whatever their address. */
async function listen(server: Server, host: string): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, host, resolve));

  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

describe('FileFetcherService', () => {
  const fileFetcherService = new FileFetcherService(CONFIG, new FileDigestService());

  let directory: string;
  let location: IFileLocation;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let onProgress: ReturnType<typeof vi.fn<FetchProgress>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-fetch-'));
    location = {
      modelDirectory: directory,
      filePath: join(directory, 'model.gguf'),
      partialPath: join(directory, 'model.gguf.part'),
    };

    fetchMock = vi.fn<typeof fetch>();
    onProgress = vi.fn<FetchProgress>();

    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    writeFailure.code = null;
    accessFailure.code = null;

    await rm(directory, { recursive: true, force: true });
  });

  async function run(): Promise<void> {
    await fileFetcherService.fetch(DOWNLOAD, FILE, location, AbortSignal.timeout(10_000), onProgress);
  }

  async function exists(path: string): Promise<boolean> {
    return stat(path).then(
      () => true,
      () => false
    );
  }

  describe('fetch', () => {
    it('writes the file under its partial name and renames it into place once the digest matches', async () => {
      fetchMock.mockResolvedValue(whole());

      await run();

      expect(fetchMock).toHaveBeenCalledWith(FILE_URL, expect.anything());
      expect(await readFile(location.filePath)).toEqual(CONTENT);
      expect(await exists(location.partialPath)).toBe(false);
      expect(onProgress).toHaveBeenCalledWith(DownloadFileState.DOWNLOADING, CONTENT.length);
    });

    it('resumes a partial left on disk by asking for the rest of the file', async () => {
      await writeFile(location.partialPath, CONTENT.subarray(0, 50));
      fetchMock.mockResolvedValue(range(50));

      await run();

      expect(rangeHeaderOf(fetchMock.mock.calls[0])).toBe('bytes=50-');
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('writes the file from its start when the source ignores the range and sends it whole', async () => {
      await writeFile(location.partialPath, Buffer.from('stale bytes from somewhere else'));
      fetchMock.mockResolvedValue(whole());

      await run();

      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('discards the partial and starts again when the source answers a range other than the one asked for', async () => {
      await writeFile(location.partialPath, CONTENT.subarray(0, 50));
      fetchMock.mockResolvedValueOnce(range(40, false, 40)).mockResolvedValueOnce(whole());

      await run();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(rangeHeaderOf(fetchMock.mock.calls[1])).toBeUndefined();
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('fetches again from where a dropped connection stopped', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(bodyOf(CONTENT.subarray(0, 60), true), { status: 200 }))
        .mockResolvedValueOnce(range(60));

      await run();

      expect(rangeHeaderOf(fetchMock.mock.calls[1])).toBe('bytes=60-');
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('fails after the retry limit of attempts in a row that fetched nothing', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 503 })));

      await expect(run()).rejects.toThrow('model.gguf failed 3 times in a row: The source answered 503');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('fetches again when nothing arrives for the stall timeout', async () => {
      fetchMock
        .mockImplementationOnce((_url, init) => Promise.resolve(silent(init ?? {})))
        .mockResolvedValueOnce(whole());

      await run();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('removes what it wrote and fails, without renaming, when the file does not match its digest', async () => {
      fetchMock.mockResolvedValue(new Response(bodyOf(Buffer.alloc(CONTENT.length, 7)), { status: 200 }));

      await expect(run()).rejects.toThrow('did not match the digest the server records');
      expect(await exists(location.partialPath)).toBe(false);
      expect(await exists(location.filePath)).toBe(false);
    });

    it('fails at once, without retrying, when the source has no such file', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      const failure = run();

      await expect(failure).rejects.toBeInstanceOf(DownloadError);
      await expect(failure).rejects.toThrow('model.gguf was not found at the source');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('sends no Authorization header for a download carrying no token', async () => {
      fetchMock.mockResolvedValue(whole());

      await run();

      expect(headersOf(fetchMock.mock.calls[0]).Authorization).toBeUndefined();
    });

    it('sends the token as a bearer token beside the range it resumes from', async () => {
      await writeFile(location.partialPath, CONTENT.subarray(0, 50));
      fetchMock.mockResolvedValue(range(50));

      await fileFetcherService.fetch(
        { ...DOWNLOAD, token: TOKEN },
        FILE,
        location,
        AbortSignal.timeout(10_000),
        onProgress
      );

      expect(headersOf(fetchMock.mock.calls[0])).toEqual({ Authorization: `Bearer ${TOKEN}`, Range: 'bytes=50-' });
    });

    it("withholds the token from a URL off the endpoint's origin", async () => {
      fetchMock.mockResolvedValue(whole());

      await fileFetcherService.fetch(
        { ...DOWNLOAD, token: TOKEN },
        { ...FILE, url: 'https://elsewhere.test/model.gguf' },
        location,
        AbortSignal.timeout(10_000),
        onProgress
      );

      expect(headersOf(fetchMock.mock.calls[0]).Authorization).toBeUndefined();
    });

    it('reads a 404 bearing a token as a missing file, since the status alone cannot tell a hidden repository', async () => {
      fetchMock.mockResolvedValue(
        new Response(null, { status: 404, headers: new Headers([['x-error-code', 'RepoNotFound']]) })
      );

      await expect(
        fileFetcherService.fetch({ ...DOWNLOAD, token: TOKEN }, FILE, location, AbortSignal.timeout(10_000), onProgress)
      ).rejects.toThrow('model.gguf was not found at the source');
    });

    it.each([401, 403])(
      'fails at once, saying the source refused the token, when it answers %i to a fetch bearing one',
      async status => {
        fetchMock.mockResolvedValue(new Response(null, { status }));

        const failure = fileFetcherService.fetch(
          { ...DOWNLOAD, token: TOKEN },
          FILE,
          location,
          AbortSignal.timeout(10_000),
          onProgress
        );

        await expect(failure).rejects.toThrow('The source refused the token for model.gguf');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );

    it.each([401, 403])(
      'fails at once, saying a token is needed, when the source answers %i to an anonymous fetch',
      async status => {
        fetchMock.mockResolvedValue(new Response(null, { status }));

        await expect(run()).rejects.toThrow('model.gguf cannot be reached without a token');
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );

    it('starts again from nothing when a range answer names another total for the file', async () => {
      await writeFile(location.partialPath, CONTENT.subarray(0, 50));
      fetchMock
        .mockResolvedValueOnce(
          new Response(bodyOf(CONTENT.subarray(50)), {
            status: 206,
            headers: new Headers([['content-range', `bytes 50-99/200`]]),
          })
        )
        .mockResolvedValueOnce(whole());

      await run();

      expect(rangeHeaderOf(fetchMock.mock.calls[1])).toBeUndefined();
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('fails at once, naming the file, when its directory cannot be made', async () => {
      await writeFile(join(directory, 'taken'), 'a file where a directory should go');
      location = {
        modelDirectory: directory,
        filePath: join(directory, 'taken', 'model.gguf'),
        partialPath: join(directory, 'taken', 'model.gguf.part'),
      };

      const failure = run();

      await expect(failure).rejects.toBeInstanceOf(DownloadError);
      await expect(failure).rejects.toThrow('model.gguf could not be written');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails at once, saying it is read-only, when the nearest directory that exists is on a read-only mount', async () => {
      accessFailure.code = 'EROFS';
      location = {
        modelDirectory: directory,
        filePath: join(directory, 'huggingface', 'owner', 'model.gguf'),
        partialPath: join(directory, 'huggingface', 'owner', 'model.gguf.part'),
      };

      const failure = run();

      await expect(failure).rejects.toBeInstanceOf(DownloadError);
      await expect(failure).rejects.toThrow(`model.gguf could not be written: ${directory} is read-only`);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['EACCES', 'EPERM'])(
      "fails at once, naming the agent's uid, when the nearest directory that exists answers %s",
      async code => {
        accessFailure.code = code;
        location = {
          modelDirectory: directory,
          filePath: join(directory, 'huggingface', 'owner', 'model.gguf'),
          partialPath: join(directory, 'huggingface', 'owner', 'model.gguf.part'),
        };

        const failure = run();

        await expect(failure).rejects.toBeInstanceOf(DownloadError);
        await expect(failure).rejects.toThrow(
          `model.gguf could not be written: permission denied to the agent's user (uid ${process.getuid?.()}) at ${directory}`
        );
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it.skipIf(process.getuid?.() === 0)(
      "fails at once, naming the agent's uid, when a directory it would create beneath refuses its user",
      async () => {
        const refusing = join(directory, 'huggingface');

        await mkdir(refusing);
        await chmod(refusing, 0o555);
        location = {
          modelDirectory: directory,
          filePath: join(refusing, 'owner', 'model.gguf'),
          partialPath: join(refusing, 'owner', 'model.gguf.part'),
        };

        const failure = run();

        await expect(failure).rejects.toBeInstanceOf(DownloadError);
        await expect(failure).rejects.toThrow(
          `model.gguf could not be written: permission denied to the agent's user (uid ${process.getuid?.()}) at ${refusing}`
        );
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );

    it('fails naming a missing model directory rather than checking the directory above it', async () => {
      const models = join(directory, 'models');

      location = {
        modelDirectory: models,
        filePath: join(models, 'huggingface', 'model.gguf'),
        partialPath: join(models, 'huggingface', 'model.gguf.part'),
      };

      await expect(run()).rejects.toThrow(`no such file or directory, access '${models}'`);
      expect(await exists(models)).toBe(false);
    });

    it('fails when the source sends more than the server records the file holding', async () => {
      fetchMock.mockResolvedValue(new Response(bodyOf(Buffer.concat([CONTENT, CONTENT])), { status: 200 }));

      await expect(run()).rejects.toThrow('The source sent more of model.gguf than the server records it holding');
    });

    it('fails at once, fetching nothing, for a file the server named no URL for', async () => {
      const unresolved: DesiredDownloadFile = { path: FILE.path, sizeBytes: FILE.sizeBytes, digest: FILE.digest };

      await expect(
        fileFetcherService.fetch(DOWNLOAD, unresolved, location, AbortSignal.timeout(10_000), onProgress)
      ).rejects.toThrow('The server named no URL for model.gguf');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('fetch, redirected to a CDN', () => {
    const seen: { hub?: IncomingHttpHeaders; cdn?: IncomingHttpHeaders } = {};
    const cdn = createServer((request, response) => {
      seen.cdn = request.headers;
      response.writeHead(200).end(CONTENT);
    });
    let cdnUrl: string;
    const hub = createServer((request, response) => {
      seen.hub = request.headers;
      response.writeHead(302, { location: `${cdnUrl}/signed` }).end();
    });
    let hubUrl: string;

    beforeEach(async () => {
      vi.unstubAllGlobals();

      cdnUrl = await listen(cdn, 'localhost');
      hubUrl = await listen(hub, '127.0.0.1');
    });

    afterEach(async () => {
      await Promise.all([cdn, hub].map(server => new Promise(resolve => server.close(resolve))));
    });

    it('sends the token to the source and not to the host it redirects to', async () => {
      await fileFetcherService.fetch(
        { ...DOWNLOAD, endpoint: hubUrl, token: TOKEN },
        { ...FILE, url: `${hubUrl}/owner/repo/resolve/main/model.gguf` },
        location,
        AbortSignal.timeout(10_000),
        onProgress
      );

      expect(seen.hub?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(seen.cdn?.authorization).toBeUndefined();
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });
  });

  describe('fetch, when interrupted', () => {
    /** Sends the next ten bytes from wherever the request starts, then drops, until the file is whole. */
    function tenBytesAtATime(init: RequestInit | undefined): Response {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      const from = range === undefined ? 0 : Number(/bytes=(\d+)-/.exec(range)?.[1]);
      const to = Math.min(from + 10, CONTENT.length);
      const body = bodyOf(CONTENT.subarray(from, to), to < CONTENT.length);

      if (from === 0) {
        return new Response(body, { status: 200 });
      }

      return new Response(body, {
        status: 206,
        headers: new Headers([['content-range', `bytes ${from}-${CONTENT.length - 1}/${CONTENT.length}`]]),
      });
    }

    it('keeps going past the retry limit while every attempt adds something', async () => {
      fetchMock.mockImplementation((_url, init) => Promise.resolve(tenBytesAtATime(init)));

      await run();

      expect(fetchMock.mock.calls.length).toBeGreaterThan(CONFIG.downloadRetryLimit);
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('renames a partial that is already whole without fetching, as after a crash before the rename', async () => {
      await writeFile(location.partialPath, CONTENT);

      await run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('starts again from nothing when the source cannot satisfy the range asked for', async () => {
      await writeFile(location.partialPath, CONTENT.subarray(0, 50));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 416 })).mockResolvedValueOnce(whole());

      await run();

      expect(rangeHeaderOf(fetchMock.mock.calls[1])).toBeUndefined();
      expect(await readFile(location.filePath)).toEqual(CONTENT);
    });

    it('fails at once, saying it is read-only, when a write already under way meets a read-only mount', async () => {
      writeFailure.code = 'EROFS';
      fetchMock.mockResolvedValue(whole());

      await expect(run()).rejects.toThrow('model.gguf could not be written: its directory is read-only');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('fails at once, saying the disk filled, rather than retrying a write that cannot succeed', async () => {
      writeFailure.code = 'ENOSPC';
      fetchMock.mockResolvedValue(whole());

      await expect(run()).rejects.toThrow('The disk filled while writing model.gguf');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('fetch, of an empty file', () => {
    it('writes it without asking the source for a body', async () => {
      const empty: DesiredDownloadFile = {
        path: 'model.gguf',
        url: FILE_URL,
        sizeBytes: 0,
        digest: { algorithm: DownloadDigestAlgorithm.SHA256, value: createHash('sha256').digest('hex') },
      };

      await fileFetcherService.fetch(DOWNLOAD, empty, location, AbortSignal.timeout(10_000), onProgress);

      expect(fetchMock).not.toHaveBeenCalled();
      expect((await readFile(location.filePath)).length).toBe(0);
    });
  });

  describe('isHeld', () => {
    let signal: AbortSignal;

    // A timeout signal counts from when it is made, so each test needs its own.
    beforeEach(() => {
      signal = AbortSignal.timeout(10_000);
    });

    it('reads a file already at its final name with the right digest as held', async () => {
      await writeFile(location.filePath, CONTENT);

      await expect(fileFetcherService.isHeld(FILE, location, signal)).resolves.toBe(true);
    });

    it('reads a missing file as not held', async () => {
      await expect(fileFetcherService.isHeld(FILE, location, signal)).resolves.toBe(false);
    });

    it('refuses a file of the same size and different content rather than overwriting it', async () => {
      await writeFile(location.filePath, Buffer.alloc(CONTENT.length, 7));

      await expect(fileFetcherService.isHeld(FILE, location, signal)).rejects.toThrow('A different file is already at');
    });

    it('refuses a file of another size without reading it', async () => {
      await writeFile(location.filePath, CONTENT.subarray(1));

      await expect(fileFetcherService.isHeld(FILE, location, signal)).rejects.toThrow('A different file is already at');
    });
  });

  describe('partialBytes', () => {
    it('counts a partial longer than the file as nothing, so it is written over', async () => {
      await writeFile(location.partialPath, Buffer.concat([CONTENT, CONTENT]));

      await expect(fileFetcherService.partialBytes(FILE, location)).resolves.toBe(0);
    });
  });
});
