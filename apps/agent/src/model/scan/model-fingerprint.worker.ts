import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';

import type { IHashWorkerResult } from '../../common/hash-worker';

const shardSegmentSchema = z.object({
  path: z.string().min(1),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});

const modelFingerprintJobSchema = z.object({
  /** Digested in order, each range's segments in order. */
  ranges: z.array(z.object({ segments: z.array(shardSegmentSchema) })),
});
export type ModelFingerprintJob = z.infer<typeof modelFingerprintJobSchema>;
type ShardSegment = z.infer<typeof shardSegmentSchema>;

const READ_BYTES = 1024 * 1024;

const job = modelFingerprintJobSchema.parse(workerData);
const hash = createHash('sha256');
const buffer = Buffer.allocUnsafe(READ_BYTES);

const reply = (result: IHashWorkerResult): void => {
  parentPort?.postMessage(result);
};

/** A file ending early ends its range there, as `ShardReader.read` does. */
const digestRange = async (segments: readonly ShardSegment[]): Promise<void> => {
  for (const segment of segments) {
    const handle = await open(segment.path, 'r');

    try {
      let position = segment.offset;
      let remaining = segment.length;

      while (remaining > 0) {
        const { bytesRead } = await handle.read(buffer, 0, Math.min(remaining, READ_BYTES), position);

        if (bytesRead === 0) {
          return;
        }

        hash.update(buffer.subarray(0, bytesRead));

        position += bytesRead;
        remaining -= bytesRead;
      }
    } finally {
      await handle.close();
    }
  }
};

const digest = async (): Promise<void> => {
  for (const range of job.ranges) {
    await digestRange(range.segments);
  }
};

digest()
  .then(() => {
    reply({ hex: hash.digest('hex') });
  })
  .catch((error: unknown) => {
    reply({ error: error instanceof Error ? error.message : 'The model could not be read' });
  });
