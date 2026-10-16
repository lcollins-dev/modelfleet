import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';

import type { IHashWorkerResult } from '../common/hash-worker';

const fileDigestJobSchema = z.object({
  path: z.string().min(1),
  algorithm: z.enum(['sha256', 'sha1']),

  /** Hashed ahead of the file's bytes, which is how a git blob id is formed. */
  prefix: z.string().nullable(),
});
export type FileDigestJob = z.infer<typeof fileDigestJobSchema>;

const READ_BYTES = 1024 * 1024;

const job = fileDigestJobSchema.parse(workerData);
const hash = createHash(job.algorithm);

if (job.prefix !== null) {
  hash.update(job.prefix);
}

const reply = (result: IHashWorkerResult): void => {
  parentPort?.postMessage(result);
};

createReadStream(job.path, { highWaterMark: READ_BYTES })
  .on('data', chunk => hash.update(chunk))
  .on('error', error => {
    reply({ error: error.message });
  })
  .on('end', () => {
    reply({ hex: hash.digest('hex') });
  });
