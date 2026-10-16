import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DownloadDigestAlgorithm } from '@libs/agent-protocol';

import { FileDigestService } from '@/download/file-digest.service';
import { DownloadError } from '@/download/types/errors';

vi.mock('node:worker_threads', async importOriginal => {
  const original = await importOriginal<typeof import('node:worker_threads')>();

  return {
    ...original,
    Worker: vi.fn(function (...args: ConstructorParameters<typeof original.Worker>) {
      return new original.Worker(...args);
    }),
  };
});

const CONTENT = Buffer.from('{"architectures": ["Qwen3ForCausalLM"]}\n');

describe('FileDigestService', () => {
  const fileDigestService = new FileDigestService();

  let directory: string;
  let path: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'modelfleet-digest-'));
    path = join(directory, 'config.json');

    await writeFile(path, CONTENT);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('matches an LFS object by the sha-256 of its content', async () => {
    const value = createHash('sha256').update(CONTENT).digest('hex');
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value };

    await expect(fileDigestService.matches(path, digest, CONTENT.length, AbortSignal.timeout(10_000))).resolves.toBe(
      true
    );
  });

  it('matches a git blob by the sha-1 of its header and content, as `git hash-object` forms it', async () => {
    const value = createHash('sha1').update(`blob ${CONTENT.length}\0`).update(CONTENT).digest('hex');
    const digest = { algorithm: DownloadDigestAlgorithm.GIT_SHA1, value };

    await expect(fileDigestService.matches(path, digest, CONTENT.length, AbortSignal.timeout(10_000))).resolves.toBe(
      true
    );
  });

  it('does not match content that differs', async () => {
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) };

    await expect(fileDigestService.matches(path, digest, CONTENT.length, AbortSignal.timeout(10_000))).resolves.toBe(
      false
    );
  });

  it('rejects a file that cannot be read with a reason the operator is shown', async () => {
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) };
    const reading = fileDigestService.matches(join(directory, 'missing'), digest, 0, AbortSignal.timeout(10_000));

    await expect(reading).rejects.toBeInstanceOf(DownloadError);
    await expect(reading).rejects.toThrow('missing could not be read');
  });

  it('rejects where its worker stops without a result, so the download fails rather than hangs', async () => {
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) };
    const worker = Object.assign(new EventEmitter(), { terminate: vi.fn() });

    vi.mocked(Worker).mockImplementationOnce(function () {
      return worker as unknown as Worker;
    });

    const reading = fileDigestService.matches(path, digest, CONTENT.length, AbortSignal.timeout(10_000));

    worker.emit('exit', 1);

    await expect(reading).rejects.toBeInstanceOf(DownloadError);
    await expect(reading).rejects.toThrow('its worker stopped without a result');
  });

  it('rejects at once when the caller aborts', async () => {
    const digest = { algorithm: DownloadDigestAlgorithm.SHA256, value: 'a'.repeat(64) };

    await expect(fileDigestService.matches(path, digest, CONTENT.length, AbortSignal.abort())).rejects.toThrow(
      'The digest was stopped'
    );
  });
});
