/** One pending deadline at a time: expecting another replaces it. The timer never holds the process open. */
export class Deadline {
  private timer: NodeJS.Timeout | null = null;

  expect(delayMs: number, onMissed: () => void): void {
    this.stop();

    this.timer = setTimeout(onMissed, delayMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
