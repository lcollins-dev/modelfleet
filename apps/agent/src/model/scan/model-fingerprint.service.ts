import { Injectable } from '@nestjs/common';
import { extname, join } from 'node:path';

import { HashWorker, HashWorkerError, HashWorkerFailure } from '../../common/hash-worker';
import type { ModelFingerprintJob } from './model-fingerprint.worker';
import { ShardReader } from './shard-reader';

export const SAMPLE_BYTES = 8 * 1024 * 1024;
export const SAMPLE_COUNT = 3;
export const SAMPLE_SPAN_BYTES = SAMPLE_BYTES * SAMPLE_COUNT;

/** The compiled `.js` beside this file in a build, and the source `.ts` under the test runner. */
const WORKER_PATH = join(__dirname, `model-fingerprint.worker${extname(__filename)}`);

export interface ISampleRange {
  offset: number;
  length: number;
}

@Injectable()
export class ModelFingerprintService {
  private readonly hashWorker = new HashWorker(WORKER_PATH);

  /** A SHA-256 over the model's samples, taking in neither its path nor its byte size. */
  async digest(stream: ShardReader): Promise<string> {
    const job: ModelFingerprintJob = {
      ranges: this.sampleRanges(stream.sizeBytes).map(range => ({
        segments: stream.segments(range.offset, range.length),
      })),
    };

    try {
      return await this.hashWorker.run(job);
    } catch (error: unknown) {
      throw error instanceof HashWorkerError ? this.failure(error) : error;
    }
  }

  /** Head, middle and tail, in the order they are digested. */
  sampleRanges(sizeBytes: number): ISampleRange[] {
    if (sizeBytes <= SAMPLE_SPAN_BYTES) {
      return [{ offset: 0, length: sizeBytes }];
    }

    return [
      { offset: 0, length: SAMPLE_BYTES },
      { offset: Math.floor(sizeBytes / 2) - SAMPLE_BYTES / 2, length: SAMPLE_BYTES },
      { offset: sizeBytes - SAMPLE_BYTES, length: SAMPLE_BYTES },
    ];
  }

  private failure(error: HashWorkerError): Error {
    if (error.failure === HashWorkerFailure.UNREADABLE) {
      return new Error(error.reason ?? 'The model could not be read');
    }

    return new Error(`The fingerprint could not be taken: ${error.reason}`);
  }
}
