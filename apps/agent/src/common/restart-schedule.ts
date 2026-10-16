import { Backoff, IBackoffOptions } from './backoff';

export class RestartSchedule {
  private readonly backoff: Backoff;

  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    options: IBackoffOptions,
    private readonly restart: () => void,
    random?: () => number
  ) {
    this.backoff = new Backoff(options, random);
  }

  get attempts(): number {
    return this.backoff.attempts;
  }

  schedule(): number | null {
    if (this.stopped) {
      return null;
    }

    const delayMs = this.backoff.next();

    this.timer = setTimeout(() => {
      this.timer = null;
      this.restart();
    }, delayMs);

    return delayMs;
  }

  reset(): void {
    this.backoff.reset();
  }

  stop(): void {
    this.stopped = true;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
