import { Worker } from 'node:worker_threads';

export interface IHashWorkerResult {
  hex?: string;
  error?: string;
}

export enum HashWorkerFailure {
  UNREADABLE = 'unreadable',
  CRASHED = 'crashed',
  STOPPED = 'stopped',
}

export class HashWorkerError extends Error {
  constructor(
    readonly failure: HashWorkerFailure,
    readonly reason: string | undefined
  ) {
    super(reason ?? failure);
    this.name = 'HashWorkerError';
  }
}

/**
 * Hashes off the main thread. Read from the page cache, a file hashes at memory speed, which on the main thread holds
 * up the relay streaming tokens for tens of milliseconds at a time.
 */
export class HashWorker {
  constructor(private readonly workerPath: string) {}

  /** Rejects with a `HashWorkerError`. An abort terminates the worker. */
  run(workerData: unknown, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted === true) {
      return Promise.reject(new HashWorkerError(HashWorkerFailure.STOPPED, undefined));
    }

    const worker = new Worker(this.workerPath, { workerData });

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        void worker.terminate();
        reject(new HashWorkerError(HashWorkerFailure.STOPPED, undefined));
      };

      signal?.addEventListener('abort', onAbort, { once: true });

      worker.once('message', (result: IHashWorkerResult) => {
        signal?.removeEventListener('abort', onAbort);
        void worker.terminate();

        if (result.hex === undefined) {
          reject(new HashWorkerError(HashWorkerFailure.UNREADABLE, result.error));
        } else {
          resolve(result.hex);
        }
      });

      worker.once('error', (error: Error) => {
        signal?.removeEventListener('abort', onAbort);
        reject(new HashWorkerError(HashWorkerFailure.CRASHED, error.message));
      });

      worker.once('exit', () => {
        signal?.removeEventListener('abort', onAbort);
        reject(new HashWorkerError(HashWorkerFailure.CRASHED, 'its worker stopped without a result'));
      });
    });
  }
}
