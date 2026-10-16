import { describe, expect, it } from 'vitest';

import { decodeAgentMessage, decodeServerMessage, encodeAgentMessage, encodeServerMessage } from '../codec';
import { AgentMessageType, ServerMessageType } from '../message-type';
import {
  AgentDownloadProgress,
  DownloadDigestAlgorithm,
  DownloadFileState,
  DownloadSource,
  DownloadState,
  MAX_DOWNLOAD_URL_LENGTH,
  ServerDesiredDownloads,
  desiredDownloadSchema,
  downloadDigestSchema,
  downloadPathSchema,
} from './download';

const DOWNLOAD_KEY = '6f1f4c1e-3a7b-4c1d-9a55-0d2b3c4d5e6f';

const DESIRED: ServerDesiredDownloads = {
  downloads: [
    {
      downloadKey: DOWNLOAD_KEY,
      attempt: 0,
      source: DownloadSource.HUGGINGFACE,
      endpoint: 'https://huggingface.co',
      repository: 'unsloth/Qwen3-0.6B-GGUF',
      directory: 'huggingface/unsloth/Qwen3-0.6B-GGUF',
      revision: '50968a4468ef4233ed78cd7c3de230dd1d61a56b',
      files: [
        {
          path: 'Qwen3-0.6B-Q8_0.gguf',
          sizeBytes: 639_447_744,
          digest: {
            algorithm: DownloadDigestAlgorithm.SHA256,
            value: 'e150ed544dfe6016930c026a93913a5e3184181ebfe6ab2223ae01dd0491784c',
          },
        },
        {
          path: 'config.json',
          sizeBytes: 752,
          digest: { algorithm: DownloadDigestAlgorithm.GIT_SHA1, value: 'de077778adaa4aa6e706209cd95a2a0d6049bc59' },
        },
      ],
    },
  ],
};

const PROGRESS: AgentDownloadProgress = {
  downloads: [
    {
      downloadKey: DOWNLOAD_KEY,
      attempt: 0,
      state: DownloadState.DOWNLOADING,
      message: null,
      files: [
        { path: 'Qwen3-0.6B-Q8_0.gguf', state: DownloadFileState.DOWNLOADING, bytesDone: 1_000_000 },
        { path: 'config.json', state: DownloadFileState.PENDING, bytesDone: 0 },
      ],
    },
  ],
};

describe('downloadPathSchema', () => {
  it('takes a file in a subdirectory of the repository', () => {
    expect(downloadPathSchema.safeParse('Q4_K_M/model-00001-of-00002.gguf').success).toBe(true);
  });

  it.each(['../escape.gguf', 'a/../../escape.gguf', '/etc/passwd', 'a//b.gguf', './a.gguf', 'a\\b.gguf', 'a/'])(
    'refuses %s, which would not stay under the repository directory',
    path => {
      expect(downloadPathSchema.safeParse(path).success).toBe(false);
    }
  );

  it('refuses a name ending in the partial suffix, which a finished file would share with a partial one', () => {
    expect(downloadPathSchema.safeParse('model.gguf.PART').success).toBe(false);
  });
});

describe('downloadDigestSchema', () => {
  it('refuses a sha-256 of the width a git id has', () => {
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(40) };

    expect(downloadDigestSchema.safeParse(digest).success).toBe(false);
  });
});

describe('desiredDownloadSchema', () => {
  const [download] = DESIRED.downloads;

  it('refuses a branch name, since only a commit pins the bytes', () => {
    expect(desiredDownloadSchema.safeParse({ ...download, revision: 'main' }).success).toBe(false);
  });

  it.each(['gpt2', '../repo', 'owner/..', 'owner/repo/extra'])('refuses the repository %s', repository => {
    expect(desiredDownloadSchema.safeParse({ ...download, repository }).success).toBe(false);
  });

  it.each(['../outside', '/etc', 'a//b'])(
    'refuses the directory %s, which would not stay in the model directory',
    directory => {
      expect(desiredDownloadSchema.safeParse({ ...download, directory }).success).toBe(false);
    }
  );

  it('refuses an endpoint on a scheme the agent should not follow', () => {
    expect(desiredDownloadSchema.safeParse({ ...download, endpoint: 'file:///etc' }).success).toBe(false);
  });

  it('refuses a download naming no files', () => {
    expect(desiredDownloadSchema.safeParse({ ...download, files: [] }).success).toBe(false);
  });

  it('takes a download with a token, and one without', () => {
    expect(desiredDownloadSchema.safeParse({ ...download, token: 'hf_abcDEF123' }).success).toBe(true);
    expect(desiredDownloadSchema.safeParse(download).success).toBe(true);
  });

  it('takes a file with a url, and one without', () => {
    const [file] = download.files;

    expect(
      desiredDownloadSchema.safeParse({ ...download, files: [{ ...file, url: 'https://hub.test/a' }] }).success
    ).toBe(true);
    expect(
      desiredDownloadSchema.safeParse({
        ...download,
        files: [{ path: file.path, sizeBytes: file.sizeBytes, digest: file.digest }],
      }).success
    ).toBe(true);
  });

  it.each(['file:///etc/passwd', 'ftp://hub.test/a', `https://hub.test/${'a'.repeat(MAX_DOWNLOAD_URL_LENGTH)}`])(
    'refuses the file url %s',
    url => {
      const [file] = download.files;

      expect(desiredDownloadSchema.safeParse({ ...download, files: [{ ...file, url }] }).success).toBe(false);
    }
  );

  it.each(['', 'hf_abc def', 'hf_abc\ndef', 'hf_abc\u00e9'])(
    'refuses the token %j, which a header cannot carry',
    token => {
      expect(desiredDownloadSchema.safeParse({ ...download, token }).success).toBe(false);
    }
  );
});

describe('download messages', () => {
  it('round trips a desired set', () => {
    const result = decodeServerMessage(encodeServerMessage(ServerMessageType.DESIRED_DOWNLOADS, DESIRED));

    expect(result.ok && result.message.payload).toEqual(DESIRED);
  });

  it('names no token it refuses in the reason a frame was malformed', () => {
    const token = 'hf_secret\nvalue';
    const frame = encodeServerMessage(ServerMessageType.DESIRED_DOWNLOADS, DESIRED).replace(
      `"files":`,
      `"token":${JSON.stringify(token)},"files":`
    );
    const result = decodeServerMessage(frame);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('hf_secret');
  });

  it('round trips a progress report', () => {
    const result = decodeAgentMessage(encodeAgentMessage(AgentMessageType.DOWNLOAD_PROGRESS, PROGRESS));

    expect(result.ok && result.message.payload).toEqual(PROGRESS);
  });
});
