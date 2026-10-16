import { Transform, TransformCallback } from 'node:stream';

/** Docker prefixes each chunk of a non-tty log with a stream byte, three pad bytes and a big-endian length. */
const HEADER_BYTES = 8;
const LENGTH_OFFSET = 4;

/** The first byte is 0, 1 or 2 on a framed stream, so anything else means the daemon sent the payload raw. */
const MAX_STREAM_TYPE = 2;

/** Holds a header or payload split between two reads over to the next. */
export class LogFrameReader {
  /** Decided by the stream's first byte, for the whole stream. */
  private raw: boolean | null = null;

  private readonly header = Buffer.alloc(HEADER_BYTES);
  private headerFilled = 0;
  private payloadLeft = 0;
  private framesRead = 0;

  /** Each frame is one log entry. Null on a raw stream, which carries no frames to count. */
  get frames(): number | null {
    return this.raw === true ? null : this.framesRead;
  }

  read(chunk: Buffer): Buffer {
    if (chunk.length === 0) {
      return chunk;
    }

    this.raw ??= chunk[0] > MAX_STREAM_TYPE;

    if (this.raw) {
      return chunk;
    }

    const payloads: Buffer[] = [];
    let offset = 0;

    while (offset < chunk.length) {
      if (this.payloadLeft > 0) {
        const end = Math.min(offset + this.payloadLeft, chunk.length);

        payloads.push(chunk.subarray(offset, end));
        this.payloadLeft -= end - offset;
        offset = end;

        continue;
      }

      const taken = Math.min(HEADER_BYTES - this.headerFilled, chunk.length - offset);

      chunk.copy(this.header, this.headerFilled, offset, offset + taken);
      this.headerFilled += taken;
      offset += taken;

      if (this.headerFilled === HEADER_BYTES) {
        this.payloadLeft = this.header.readUInt32BE(LENGTH_OFFSET);
        this.headerFilled = 0;
        this.framesRead += 1;
      }
    }

    return payloads.length === 1 ? payloads[0] : Buffer.concat(payloads);
  }
}

export class LogFrameStream extends Transform {
  constructor() {
    const reader = new LogFrameReader();

    super({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
        const payload = reader.read(chunk);

        callback(null, payload.length > 0 ? payload : undefined);
      },
    });
  }
}
