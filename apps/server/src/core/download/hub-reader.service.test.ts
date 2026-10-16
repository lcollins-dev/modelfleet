import { HubApiError, ListFileEntry, listFiles, modelInfo, pathsInfo } from '@huggingface/hub';
import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadDigestAlgorithm } from '@libs/agent-protocol';

import { ConfigService } from '@/config/config.service';
import { HubReaderService, MAX_LISTED_FILES } from '@/core/download/hub-reader.service';

import { issuesFrom } from '@/test/validation';

vi.mock('@huggingface/hub', async importOriginal => ({
  ...(await importOriginal<typeof import('@huggingface/hub')>()),
  listFiles: vi.fn(),
  modelInfo: vi.fn(),
  pathsInfo: vi.fn(),
}));

const COMMIT = '50968a4468ef4233ed78cd7c3de230dd1d61a56b';
const ENDPOINT = 'https://hub.test';
const TOKEN = 'hf_fleetToken123';

const GGUF = {
  path: 'Qwen3-0.6B-Q8_0.gguf',
  type: 'file',
  oid: 'f8f078643b71179df66f671b3f576db3925db1ea',
  size: 639_447_744,
  lfs: { oid: 'e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c', size: 639_447_744, pointerSize: 134 },
};

const CONFIG = { path: 'config.json', type: 'file', oid: 'de077778adaa4aa6e706209cd95a2a0d6049bc59', size: 752 };

const DIRECTORY = { path: 'Q4_K_M', type: 'directory', size: 0 };

const SHARD = { path: 'Q4_K_M/model-00001-of-00002.gguf', type: 'file', size: 5_000_000_000 };

describe('HubReaderService', () => {
  const listFilesMock = vi.mocked(listFiles);
  const modelInfoMock = vi.mocked(modelInfo);
  const pathsInfoMock = vi.mocked(pathsInfo);

  const hubReaderService = new HubReaderService({
    huggingfaceEndpoint: ENDPOINT,
    huggingfaceToken: null,
  } as unknown as ConfigService);
  const tokenReaderService = new HubReaderService({
    huggingfaceEndpoint: ENDPOINT,
    huggingfaceToken: TOKEN,
  } as unknown as ConfigService);

  const gated = (): void => {
    modelInfoMock.mockResolvedValue({
      name: 'meta-llama/Llama-3.1-8B',
      sha: COMMIT,
      gated: 'manual',
    } as unknown as Awaited<ReturnType<typeof modelInfo>>);
  };

  /** Answers through the fetch the call was handed, as the Hub client does, so the reader sees the error code. */
  const refusing = (call: typeof modelInfoMock | typeof pathsInfoMock, statusCode: number, errorCode?: string) => {
    const headers = new Headers(errorCode === undefined ? [] : [['x-error-code', errorCode]]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: statusCode, headers })));
    call.mockImplementation(async (params: { fetch?: typeof fetch }) => {
      await params.fetch?.(`${ENDPOINT}/api/models/owner/repo`);

      throw new HubApiError(`${ENDPOINT}/api/models/owner/repo`, statusCode);
    });
  };

  /** Throws `failure` once every entry is yielded, where one is given. */
  const listing = (entries: object[], failure?: Error): void => {
    listFilesMock.mockImplementation(async function* () {
      for (const entry of entries) {
        yield await Promise.resolve(entry as ListFileEntry);
      }

      if (failure !== undefined) {
        throw failure;
      }
    });
  };

  beforeEach(() => {
    listFilesMock.mockReset();
    modelInfoMock.mockReset();
    pathsInfoMock.mockReset();

    modelInfoMock.mockResolvedValue({
      name: 'unsloth/Qwen3-0.6B-GGUF',
      sha: COMMIT,
      gated: false,
    } as unknown as Awaited<ReturnType<typeof modelInfo>>);
    pathsInfoMock.mockResolvedValue([CONFIG, GGUF]);
    listing([GGUF, DIRECTORY, SHARD, CONFIG]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the revision to its commit and reads each file at that commit, from the configured endpoint', async () => {
    const snapshot = await hubReaderService.read('unsloth/qwen3-0.6b-gguf', 'main', [GGUF.path, CONFIG.path]);

    expect(modelInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'unsloth/qwen3-0.6b-gguf', revision: 'main', hubUrl: ENDPOINT })
    );
    expect(pathsInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'unsloth/Qwen3-0.6B-GGUF', revision: COMMIT, hubUrl: ENDPOINT })
    );
    expect(snapshot.repository).toBe('unsloth/Qwen3-0.6B-GGUF');
    expect(snapshot.revision).toBe(COMMIT);
  });

  it('checks an LFS file by its sha-256 and any other by its git id, in the order they were asked for', async () => {
    const snapshot = await hubReaderService.read('unsloth/Qwen3-0.6B-GGUF', 'main', [GGUF.path, CONFIG.path]);

    expect(snapshot.files).toEqual([
      { path: GGUF.path, sizeBytes: GGUF.size, digestAlgorithm: DownloadDigestAlgorithm.SHA256, digest: GGUF.lfs.oid },
      { path: CONFIG.path, sizeBytes: 752, digestAlgorithm: DownloadDigestAlgorithm.GIT_SHA1, digest: CONFIG.oid },
    ]);
  });

  it('refuses a gated repository before reading its files, saying a token is needed', async () => {
    gated();

    await expect(hubReaderService.read('meta-llama/Llama-3.1-8B', 'main', ['config.json'])).rejects.toThrow(
      new BadRequestException('meta-llama/Llama-3.1-8B is gated, and cannot be downloaded without a token')
    );
    expect(pathsInfoMock).not.toHaveBeenCalled();
  });

  it('refuses a repository the Hub will not show without a token', async () => {
    modelInfoMock.mockRejectedValue(new HubApiError(`${ENDPOINT}/api/models/owner/private`, 401));

    await expect(hubReaderService.read('owner/private', 'main', ['a.gguf'])).rejects.toThrow(
      'owner/private does not exist, or is private and cannot be reached without a token'
    );
  });

  it('refuses a revision the repository does not have', async () => {
    modelInfoMock.mockRejectedValue(new HubApiError(`${ENDPOINT}/api/models/owner/repo/revision/nope`, 404));

    await expect(hubReaderService.read('owner/repo', 'nope', ['a.gguf'])).rejects.toThrow(
      'owner/repo has no revision nope'
    );
  });

  it('refuses, naming them, files the repository does not hold at the commit', async () => {
    pathsInfoMock.mockResolvedValue([CONFIG]);

    await expect(
      hubReaderService.read('unsloth/Qwen3-0.6B-GGUF', 'main', ['config.json', 'nope.gguf'])
    ).rejects.toThrow(`unsloth/Qwen3-0.6B-GGUF holds no file nope.gguf at ${COMMIT}`);
  });

  it('refuses a path that names a directory rather than a file', async () => {
    pathsInfoMock.mockResolvedValue([{ path: 'Q4_K_M', type: 'directory', size: 0 }]);

    await expect(hubReaderService.read('unsloth/Qwen3-0.6B-GGUF', 'main', ['Q4_K_M'])).rejects.toThrow(
      'holds no file Q4_K_M'
    );
  });

  it('refuses on the repository that the Hub could not be read where it cannot be reached at all', async () => {
    modelInfoMock.mockRejectedValue(new TypeError('fetch failed'));

    expect(await issuesFrom(() => hubReaderService.read('owner/repo', 'main', ['a.gguf']))).toEqual([
      { path: 'repository', name: 'Repository', message: `${ENDPOINT} could not be read` },
    ]);
  });

  it('names a missing revision as such where the Hub answers 404 naming no repository', async () => {
    refusing(modelInfoMock, 404, 'RevisionNotFound');

    await expect(tokenReaderService.read('owner/repo', 'nope', ['a.gguf'])).rejects.toThrow(
      'owner/repo has no revision nope'
    );
  });

  describe('with a token', () => {
    it('reads a gated repository, leaving the Hub to answer for whether its account was granted access', async () => {
      gated();

      const snapshot = await tokenReaderService.read('meta-llama/Llama-3.1-8B', 'main', [CONFIG.path]);

      expect(snapshot.files).toHaveLength(1);
    });

    it('says the token has not been granted a gated repository its account has not accepted', async () => {
      gated();
      refusing(pathsInfoMock, 403, 'GatedRepo');

      await expect(tokenReaderService.read('meta-llama/Llama-3.1-8B', 'main', ['config.json'])).rejects.toThrow(
        new BadRequestException(
          'meta-llama/Llama-3.1-8B is gated, and the account HUGGINGFACE_TOKEN belongs to has not been granted access'
        )
      );
    });

    it.each([
      [401, 'RepoNotFound'],
      [401, undefined],
      [403, undefined],
    ])('says the token cannot reach a repository the Hub answers %i (%s) for', async (statusCode, errorCode) => {
      refusing(modelInfoMock, statusCode, errorCode);

      await expect(tokenReaderService.read('owner/private', 'main', ['a.gguf'])).rejects.toThrow(
        new BadRequestException('owner/private does not exist, or HUGGINGFACE_TOKEN cannot reach it')
      );
    });
  });

  it('refuses a repository not named owner/name before asking the Hub', async () => {
    await expect(hubReaderService.list('owner/repo/../../x', 'main')).rejects.toThrow(
      new BadRequestException('A repository is named as owner/name')
    );
    expect(modelInfoMock).not.toHaveBeenCalled();
  });

  describe('fileUrl', () => {
    it('names the file at the commit under the configured endpoint', () => {
      expect(hubReaderService.fileUrl('owner/repo', COMMIT, 'model.gguf')).toBe(
        `${ENDPOINT}/owner/repo/resolve/${COMMIT}/model.gguf`
      );
    });

    it('encodes each segment of the path, keeping the slashes between them', () => {
      expect(hubReaderService.fileUrl('owner/repo', COMMIT, 'onnx/model #1.onnx')).toBe(
        `${ENDPOINT}/owner/repo/resolve/${COMMIT}/onnx/model%20%231.onnx`
      );
    });

    it('drops a trailing slash on the endpoint', () => {
      const slashed = new HubReaderService({ huggingfaceEndpoint: `${ENDPOINT}/` } as unknown as ConfigService);

      expect(slashed.fileUrl('owner/repo', COMMIT, 'config.json')).toBe(
        `${ENDPOINT}/owner/repo/resolve/${COMMIT}/config.json`
      );
    });
  });

  describe('list', () => {
    it('lists the whole tree at the commit the revision points at, from the configured endpoint', async () => {
      const listed = await hubReaderService.list('unsloth/qwen3-0.6b-gguf', 'main');

      expect(listFilesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'unsloth/Qwen3-0.6B-GGUF',
          recursive: true,
          revision: COMMIT,
          hubUrl: ENDPOINT,
        })
      );
      expect(listed.repository).toBe('unsloth/Qwen3-0.6B-GGUF');
      expect(listed.revision).toBe(COMMIT);
    });

    it('lists every file with its size, sorted by path, and no directories', async () => {
      const listed = await hubReaderService.list('unsloth/Qwen3-0.6B-GGUF', 'main');

      expect(listed.files).toEqual([
        { path: CONFIG.path, sizeBytes: CONFIG.size },
        { path: SHARD.path, sizeBytes: SHARD.size },
        { path: GGUF.path, sizeBytes: GGUF.size },
      ]);
      expect(listed.truncated).toBe(false);
    });

    it(`stops at ${MAX_LISTED_FILES} files and says the list is short`, async () => {
      listing(
        Array.from({ length: MAX_LISTED_FILES + 1 }, (_, i) => ({ path: `file-${i}.bin`, type: 'file', size: 1 }))
      );

      const listed = await hubReaderService.list('owner/huge', 'main');

      expect(listed.files).toHaveLength(MAX_LISTED_FILES);
      expect(listed.truncated).toBe(true);
    });

    it('lists exactly the cap without calling it short', async () => {
      listing(Array.from({ length: MAX_LISTED_FILES }, (_, i) => ({ path: `file-${i}.bin`, type: 'file', size: 1 })));

      expect((await hubReaderService.list('owner/full', 'main')).truncated).toBe(false);
    });

    it('refuses a gated repository without listing it', async () => {
      gated();

      await expect(hubReaderService.list('meta-llama/Llama-3.1-8B', 'main')).rejects.toThrow(
        'meta-llama/Llama-3.1-8B is gated, and cannot be downloaded without a token'
      );
      expect(listFilesMock).not.toHaveBeenCalled();
    });

    it('says a repository the Hub will not show does not exist or is private, rather than listing nothing', async () => {
      modelInfoMock.mockRejectedValue(new HubApiError(`${ENDPOINT}/api/models/owner/nope`, 401));

      await expect(hubReaderService.list('owner/nope', 'main')).rejects.toThrow(
        new BadRequestException('owner/nope does not exist, or is private and cannot be reached without a token')
      );
    });

    it('refuses on the repository that the Hub could not be read where the tree fails part way', async () => {
      listing([GGUF], new TypeError('fetch failed'));

      expect(await issuesFrom(() => hubReaderService.list('unsloth/Qwen3-0.6B-GGUF', 'main'))).toEqual([
        { path: 'repository', name: 'Repository', message: `${ENDPOINT} could not be read` },
      ]);
    });
  });
});
