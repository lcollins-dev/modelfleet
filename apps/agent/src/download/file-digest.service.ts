import { Injectable } from '@nestjs/common';
import { extname, join } from 'node:path';

import { DownloadDigest, DownloadDigestAlgorithm } from '@libs/agent-protocol';

import { HashWorker, HashWorkerError, HashWorkerFailure } from '../common/hash-worker';
import type { FileDigestJob } from './file-digest.worker';
import { DownloadError } from './types/errors';

/** The compiled `.js` beside this file in a build, and the source `.ts` under the test runner. */
const WORKER_PATH = join(__dirname, `file-digest.worker${extname(__filename)}`);

@Injectable()
export class FileDigestService {
  private readonly hashWorker = new HashWorker(WORKER_PATH);

  async matches(path: string, digest: DownloadDigest, sizeBytes: number, signal: AbortSignal): Promise<boolean> {
    const isSha256 = digest.algorithm === DownloadDigestAlgorithm.SHA256;
    const job: FileDigestJob = {
      path,
      algorithm: isSha256 ? 'sha256' : 'sha1',
      prefix: isSha256 ? null : `blob ${sizeBytes}\0`,
    };

    try {
      return (await this.hashWorker.run(job, signal)) === digest.value;
    } catch (error: unknown) {
      throw error instanceof HashWorkerError ? this.failure(error, path) : error;
    }
  }

  private failure(error: HashWorkerError, path: string): Error {
    switch (error.failure) {
      case HashWorkerFailure.STOPPED:
        return this.stopped();

      case HashWorkerFailure.UNREADABLE:
        return new DownloadError(`${path} could not be read: ${error.reason ?? 'no reason given'}`);

      case HashWorkerFailure.CRASHED:
        return new DownloadError(`The digest of ${path} could not be taken: ${error.reason}`);
    }
  }

  private stopped(): DOMException {
    return new DOMException('The digest was stopped', 'AbortError');
  }
}
