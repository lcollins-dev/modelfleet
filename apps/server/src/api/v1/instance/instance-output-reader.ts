import { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { Observable, Subscriber } from 'rxjs';

import { InstanceOutputEndReason, InstanceOutputFrameDto, InstanceOutputLineDto } from '@libs/dto';

const BATCH_MS = 250;

const LINE_MAX_CHARACTERS = 8192;

/** A line that never ends is split here, so it cannot grow the carry without bound. */
const LINE_SPLIT_CHARACTERS = 64 * 1024;

const PENDING_MAX_CHARACTERS = 1024 * 1024;

/** The prefix Docker writes with `timestamps`, such as `2026-10-15T14:02:11.123456789Z `, its fraction trimmed of zeros. */
const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})((?:\.\d+)?)(Z|[+-]\d{2}:\d{2}) /;

/** One per viewer's stream, since it carries a partial line from one chunk to the next. */
export class InstanceOutputReader {
  private readonly decoder = new StringDecoder('utf8');

  private carry = '';

  private pending: InstanceOutputLineDto[] = [];
  private pendingCharacters = 0;

  /**
   * Stops reading the body while lines are backed up here or in the viewer's response, so a flood stalls the node's
   * follow rather than filling the server. Nothing is dropped. Unsubscribing destroys the body.
   */
  frames(body: Readable, viewer: Writable): Observable<InstanceOutputFrameDto> {
    return new Observable<InstanceOutputFrameDto>(subscriber => {
      const holdWhileBackedUp = () => {
        if (this.pendingCharacters > PENDING_MAX_CHARACTERS || viewer.writableNeedDrain) {
          body.pause();
        } else if (body.isPaused()) {
          body.resume();
        }
      };

      const timer = setInterval(() => {
        this.emit(subscriber, this.flush());
        holdWhileBackedUp();
      }, BATCH_MS);

      viewer.on('drain', holdWhileBackedUp);

      body.on('data', (chunk: Buffer) => {
        this.write(chunk);
        holdWhileBackedUp();
      });

      body.on('end', () => {
        clearInterval(timer);

        for (const frame of this.end()) {
          subscriber.next(frame);
        }

        subscriber.complete();
      });

      body.on('error', (error: Error) => {
        clearInterval(timer);

        this.emit(subscriber, this.flush());
        subscriber.error(error);
      });

      return () => {
        clearInterval(timer);
        viewer.off('drain', holdWhileBackedUp);
        body.destroy();
      };
    });
  }

  write(chunk: Buffer): void {
    const lines = `${this.carry}${this.decoder.write(chunk)}`.split('\n');
    this.carry = lines.pop() ?? '';

    for (const line of lines) {
      this.take(line);
    }

    if (this.carry.length > LINE_SPLIT_CHARACTERS) {
      this.take(this.carry);
      this.carry = '';
    }
  }

  flush(): InstanceOutputFrameDto | null {
    if (this.pending.length === 0) {
      return null;
    }

    const frame: InstanceOutputFrameDto = { kind: 'lines', lines: this.pending };

    this.pending = [];
    this.pendingCharacters = 0;

    return frame;
  }

  /** Flushes a partial line left at the end as a line of its own. */
  end(): InstanceOutputFrameDto[] {
    const rest = `${this.carry}${this.decoder.end()}`;

    if (rest.length > 0) {
      this.take(rest);
    }

    this.carry = '';

    const last = this.flush();
    const ended: InstanceOutputFrameDto = { kind: 'ended', reason: InstanceOutputEndReason.EXITED };

    return last === null ? [ended] : [last, ended];
  }

  private emit(subscriber: Subscriber<InstanceOutputFrameDto>, frame: InstanceOutputFrameDto | null): void {
    if (frame !== null) {
      subscriber.next(frame);
    }
  }

  /** A blank line still counts its newline, so a flood of them is bounded too. */
  private take(raw: string): void {
    const line = this.lineOf(raw.endsWith('\r') ? raw.slice(0, -1) : raw);

    this.pending.push(line);
    this.pendingCharacters += line.text.length + 1;
  }

  private lineOf(raw: string): InstanceOutputLineDto {
    const match = TIMESTAMP_PATTERN.exec(raw);
    const text = match === null ? raw : raw.slice(match[0].length);

    return {
      date: match === null ? null : this.dateOf(match),
      text: text.slice(0, LINE_MAX_CHARACTERS),
      cut: text.length > LINE_MAX_CHARACTERS,
    };
  }

  /** The spec's date format carries milliseconds alone, so Docker's nanoseconds are cut to three digits. */
  private dateOf(match: RegExpExecArray): string | null {
    const [, seconds, fraction, zone] = match;
    const date = new Date(`${seconds}.${fraction.slice(1).padEnd(3, '0').slice(0, 3)}${zone}`);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
}
