import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HashWorker, HashWorkerError, HashWorkerFailure } from '@/common/hash-worker';

const WORKERS = {
  answers:
    "import { parentPort, workerData } from 'node:worker_threads'; parentPort.postMessage({ hex: workerData.hex });",
  unreadable: "import { parentPort } from 'node:worker_threads'; parentPort.postMessage({ error: 'EACCES' });",
  throws: "throw new Error('the worker broke');",
  exits: 'process.exit(0);',
  hangs: 'setInterval(() => {}, 1000);',
};

describe('HashWorker', () => {
  let directory: string;

  const worker = (name: keyof typeof WORKERS) => new HashWorker(join(directory, `${name}.mjs`));

  const failureOf = async (run: Promise<string>): Promise<HashWorkerError> => {
    const error: unknown = await run.catch((caught: unknown) => caught);

    if (!(error instanceof HashWorkerError)) {
      throw new Error(`Expected a HashWorkerError, got ${String(error)}`);
    }

    return error;
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hash-worker-'));

    await Promise.all(
      Object.entries(WORKERS).map(([name, source]) => writeFile(join(directory, `${name}.mjs`), source))
    );
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('resolves the digest the worker posts', async () => {
    await expect(worker('answers').run({ hex: 'abc123' })).resolves.toBe('abc123');
  });

  it("rejects as unreadable, with the worker's reason, where it could not read its input", async () => {
    const error = await failureOf(worker('unreadable').run({}));

    expect(error.failure).toBe(HashWorkerFailure.UNREADABLE);
    expect(error.reason).toBe('EACCES');
  });

  it('rejects as crashed where the worker throws', async () => {
    const error = await failureOf(worker('throws').run({}));

    expect(error.failure).toBe(HashWorkerFailure.CRASHED);
    expect(error.reason).toBe('the worker broke');
  });

  it('rejects as crashed where the worker exits without a result', async () => {
    const error = await failureOf(worker('exits').run({}));

    expect(error.failure).toBe(HashWorkerFailure.CRASHED);
    expect(error.reason).toBe('its worker stopped without a result');
  });

  it('rejects as stopped, and starts nothing, on a signal already aborted', async () => {
    const error = await failureOf(worker('answers').run({ hex: 'abc123' }, AbortSignal.abort()));

    expect(error.failure).toBe(HashWorkerFailure.STOPPED);
  });

  it('rejects as stopped where the signal aborts while the worker runs', async () => {
    const controller = new AbortController();
    const running = worker('hangs').run({}, controller.signal);

    setTimeout(() => controller.abort(), 50);

    expect((await failureOf(running)).failure).toBe(HashWorkerFailure.STOPPED);
  });
});
