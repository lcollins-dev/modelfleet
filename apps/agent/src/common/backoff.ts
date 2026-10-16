export interface IBackoffOptions {
  initialDelayMs: number;
  maxDelayMs: number;
  /** The fraction of a delay drawn at random, from 0 to 1. */
  jitterRatio: number;
}

export class Backoff {
  private attempt = 0;

  constructor(
    private readonly options: IBackoffOptions,
    private readonly random: () => number = Math.random
  ) {}

  get attempts(): number {
    return this.attempt;
  }

  next(): number {
    const doubled = this.options.initialDelayMs * 2 ** this.attempt;
    const delay = Math.min(doubled, this.options.maxDelayMs);

    this.attempt += 1;

    const jitter = delay * this.options.jitterRatio * this.random();

    return Math.round(delay - jitter);
  }

  reset(): void {
    this.attempt = 0;
  }
}
