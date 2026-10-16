import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { LogFrameReader, LogFrameStream } from '@/docker/api/log-frames';

const STDOUT = 1;
const STDERR = 2;

const framed = (stream: number, payload: string): Buffer => {
  const body = Buffer.from(payload, 'utf8');
  const header = Buffer.alloc(8);

  header[0] = stream;
  header.writeUInt32BE(body.length, 4);

  return Buffer.concat([header, body]);
};

const readAll = (chunks: Buffer[]): string => {
  const reader = new LogFrameReader();

  return Buffer.concat(chunks.map(chunk => reader.read(chunk))).toString('utf8');
};

const everySplit = (data: Buffer): Buffer[][] =>
  Array.from({ length: data.length + 1 }, (_, at) => [data.subarray(0, at), data.subarray(at)]);

describe('LogFrameReader', () => {
  it('reads one frame', () => {
    expect(readAll([framed(STDOUT, 'loading model\n')])).toBe('loading model\n');
  });

  it('joins what the backend wrote to both streams, in the order the daemon sent it', () => {
    const data = Buffer.concat([framed(STDOUT, 'loading\n'), framed(STDERR, 'error: unknown flag\n')]);

    expect(readAll([data])).toBe('loading\nerror: unknown flag\n');
  });

  it('reads a tty log, which the daemon sends without any framing', () => {
    expect(readAll([Buffer.from('error: unknown flag\n', 'utf8'), Buffer.from('\u0001 next\n', 'utf8')])).toBe(
      'error: unknown flag\n\u0001 next\n'
    );
  });

  it('reads what it has of a frame the daemon truncated', () => {
    expect(readAll([framed(STDOUT, 'loading model').subarray(0, 14)])).toBe('loadin');
  });

  it('reads nothing from nothing', () => {
    expect(readAll([Buffer.alloc(0)])).toBe('');
  });

  it('carries a header or a payload split between two reads over to the next', () => {
    const data = Buffer.concat([framed(STDOUT, 'loading\n'), framed(STDERR, 'ready\n')]);

    for (const split of everySplit(data)) {
      expect(readAll(split)).toBe('loading\nready\n');
    }
  });

  it('reads a log arriving a byte at a time', () => {
    const data = Buffer.concat([framed(STDOUT, 'a\n'), framed(STDERR, 'b\n'), framed(STDOUT, 'c\n')]);

    expect(readAll(Array.from(data, byte => Buffer.from([byte])))).toBe('a\nb\nc\n');
  });

  it('reads an empty frame without losing its place', () => {
    expect(readAll([Buffer.concat([framed(STDOUT, ''), framed(STDOUT, 'after\n')])])).toBe('after\n');
  });

  it('counts frames rather than newlines, since Docker sends a line it split as several', () => {
    const reader = new LogFrameReader();

    reader.read(
      Buffer.concat([framed(STDOUT, 'first half, '), framed(STDOUT, 'second half\n'), framed(STDERR, 'b\n')])
    );

    expect(reader.frames).toBe(3);
  });

  it('counts no frames on a tty log, which carries none', () => {
    const reader = new LogFrameReader();

    reader.read(Buffer.from('a\nb\n', 'utf8'));

    expect(reader.frames).toBeNull();
  });
});

describe('LogFrameStream', () => {
  it('demultiplexes a followed log as it arrives', async () => {
    const data = Buffer.concat([framed(STDOUT, 'loading\n'), framed(STDERR, 'ready\n')]);
    const chunks: Buffer[] = [];

    for await (const chunk of Readable.from([data.subarray(0, 3), data.subarray(3, 12), data.subarray(12)]).pipe(
      new LogFrameStream()
    )) {
      chunks.push(chunk as Buffer);
    }

    expect(Buffer.concat(chunks).toString('utf8')).toBe('loading\nready\n');
  });
});
