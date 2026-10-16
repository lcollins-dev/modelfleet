import { Transform, TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { STREAM_DONE } from '@libs/backends/openai';

const EVENT_SEPARATOR = '\n\n';
const DATA_PREFIX = 'data:';

export type ChunkMapper = (chunk: unknown) => unknown;

/**
 * Pushing one event at a time is what keeps backpressure: nothing more is read from the backend
 * until the caller's socket has taken what it was given.
 */
export class SseChunkMapper extends Transform {
  private pending = '';

  /** Holds back the bytes of a character split across two chunks until the rest of it arrives. */
  private readonly decoder = new StringDecoder('utf8');

  private firstPayload: number | null = null;

  constructor(private readonly mapChunk: ChunkMapper) {
    super();
  }

  /** The `performance.now()` mark the first mapped payload was pushed at, or null where none was. */
  get firstPayloadAt(): number | null {
    return this.firstPayload;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.pending += this.decoder.write(chunk);

    const events = this.pending.split(EVENT_SEPARATOR);
    this.pending = events.pop() ?? '';

    for (const event of events) {
      this.push(this.mapped(event));
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    this.pending += this.decoder.end();

    if (this.pending.length > 0) {
      this.push(this.pending);
      this.pending = '';
    }

    callback();
  }

  /** An event carrying no JSON payload - a keepalive comment, or the terminator - travels as written. */
  private mapped(event: string): string {
    const lines = event.split('\n');
    const payload = lines
      .filter(line => line.startsWith(DATA_PREFIX))
      .map(line => line.slice(DATA_PREFIX.length).trimStart())
      .join('\n');

    if (payload.length === 0 || payload === STREAM_DONE) {
      return `${event}${EVENT_SEPARATOR}`;
    }

    this.markFirstPayload();

    const parsed = this.parsed(payload);

    if (parsed === undefined) {
      return `${event}${EVENT_SEPARATOR}`;
    }

    const others = lines.filter(line => !line.startsWith(DATA_PREFIX) && line.length > 0);

    return [...others, `${DATA_PREFIX} ${JSON.stringify(this.mapChunk(parsed))}`].join('\n') + EVENT_SEPARATOR;
  }

  private parsed(payload: string): unknown {
    try {
      return JSON.parse(payload);
    } catch {
      return undefined;
    }
  }

  private markFirstPayload(): void {
    this.firstPayload ??= performance.now();
  }
}
