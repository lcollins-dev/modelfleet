export class LineBuffer {
  private pending = '';

  constructor(private readonly maxLineBytes: number) {}

  /**
   * Returns the complete lines this chunk finished, empty ones dropped.
   * @throws {RangeError} where one line exceeds `maxLineBytes`, emptying the buffer.
   */
  push(chunk: string): string[] {
    this.pending += chunk;

    const parts = this.pending.split('\n');
    const tail = parts.pop() ?? '';

    if (tail.length > this.maxLineBytes) {
      this.pending = '';

      throw new RangeError(`A line ran past ${this.maxLineBytes} bytes without ending`);
    }

    this.pending = tail;

    return parts.map(part => part.trim()).filter(part => part.length > 0);
  }

  reset(): void {
    this.pending = '';
  }
}
