/**
 * Aborts its signal once `limitMs` passes without `progressed()` being called. A limit of 0 never aborts. The timer
 * never holds the process open.
 */
export class Stall {
  private readonly controller = new AbortController();
  private readonly timer: NodeJS.Timeout | null;

  constructor(limitMs: number) {
    this.timer = limitMs > 0 ? setTimeout(() => this.controller.abort(), limitMs).unref() : null;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get stalled(): boolean {
    return this.controller.signal.aborted;
  }

  progressed(): void {
    this.timer?.refresh();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
  }
}
