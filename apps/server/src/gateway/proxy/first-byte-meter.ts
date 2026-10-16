import { Transform, TransformCallback } from 'node:stream';

export class FirstByteMeter extends Transform {
  private firstByte: number | null = null;

  /** A `performance.now()` mark. */
  get firstPayloadAt(): number | null {
    return this.firstByte;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    if (chunk.length > 0) {
      this.firstByte ??= performance.now();
    }

    callback(null, chunk);
  }
}
