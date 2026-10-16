import { AcquireRefusal, IAcquireOptions, IAcquireResult } from './supervisor.types';

/** Long enough for a refusal the first reconcile makes to come back as a status of its own. */
const WAIT_GRACE_MS = 1000;

export interface IWaiter {
  since: Date;

  isOpen: () => boolean;

  /** False where the waiter was settled already, by leaving or timing out, and takes nothing more. */
  settle: (result: IAcquireResult) => boolean;
}

/** The requests waiting on each deployment for an instance to be ready, each settled exactly once. */
export class WaitingRequests {
  /** By deployment id. */
  private readonly waiters = new Map<number, Set<IWaiter>>();

  /**
   * Holds a request until something settles it: a reconcile, its maximum wait, or the caller leaving. `firstLook` runs
   * once it is registered, so a refusal it makes answers the request at once. `onWait` is called once the first look
   * leaves it waiting, or after a grace where that look is slow; `maxWaitMs` counts from the start either way.
   */
  async wait(deploymentId: number, options: IAcquireOptions, firstLook: () => Promise<void>): Promise<IAcquireResult> {
    const startedAt = performance.now();

    // An abort that fired before the request got here is not heard by the listener, and starts nothing.
    if (options.signal.aborted) {
      return this.resultOf({ waitedMs: 0 });
    }

    const { promise, resolve } = Promise.withResolvers<IAcquireResult>();
    const state = { open: true, told: false };

    const waiter: IWaiter = {
      since: new Date(),
      isOpen: () => state.open,
      settle: result => {
        if (!state.open) {
          return false;
        }

        state.open = false;
        resolve({ ...result, waitedMs: performance.now() - startedAt });

        return true;
      },
    };

    const leave = (): boolean => waiter.settle(this.resultOf({}));

    const tellWaiting = (): void => {
      if (state.open && !state.told) {
        state.told = true;
        options.onWait();
      }
    };

    const timeout = setTimeout(
      () => waiter.settle(this.resultOf({ refusal: AcquireRefusal.TIMED_OUT })),
      options.maxWaitMs
    );
    const grace = setTimeout(tellWaiting, WAIT_GRACE_MS);

    this.waitersOf(deploymentId).add(waiter);
    options.signal.addEventListener('abort', leave, { once: true });

    try {
      await Promise.race([firstLook(), promise]);

      tellWaiting();

      return await promise;
    } finally {
      clearTimeout(timeout);
      clearTimeout(grace);
      options.signal.removeEventListener('abort', leave);
      this.drop(deploymentId, waiter);
    }
  }

  /** The requests still waiting, as opposed to settled and on their way out. */
  open(deploymentId: number): IWaiter[] {
    return [...(this.waiters.get(deploymentId) ?? [])].filter(waiter => waiter.isOpen());
  }

  settleAll(deploymentId: number, result: IAcquireResult): void {
    for (const waiter of this.open(deploymentId)) {
      waiter.settle(result);
    }
  }

  private waitersOf(deploymentId: number): Set<IWaiter> {
    let waiters = this.waiters.get(deploymentId);

    if (waiters === undefined) {
      waiters = new Set();
      this.waiters.set(deploymentId, waiters);
    }

    return waiters;
  }

  private drop(deploymentId: number, waiter: IWaiter): void {
    const waiters = this.waiters.get(deploymentId);

    waiters?.delete(waiter);

    if (waiters?.size === 0) {
      this.waiters.delete(deploymentId);
    }
  }

  private resultOf(fields: Partial<IAcquireResult>): IAcquireResult {
    return { lease: null, refusal: null, problem: null, retryInMs: null, waitedMs: null, ...fields };
  }
}
