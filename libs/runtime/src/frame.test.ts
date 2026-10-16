import { describe, expect, it } from 'vitest';

import { readFrame } from './frame';

describe('readFrame', () => {
  it('reads a buffer', () => {
    expect(readFrame(Buffer.from('hello', 'utf8'))).toBe('hello');
  });

  it('joins the chunks a fragmented frame arrived in', () => {
    expect(readFrame([Buffer.from('he', 'utf8'), Buffer.from('llo', 'utf8')])).toBe('hello');
  });

  it('reads an array buffer', () => {
    const buffer = Buffer.from('hello', 'utf8');

    expect(readFrame(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength))).toBe('hello');
  });

  it('reads a multi-byte character split across two chunks', () => {
    const snowman = Buffer.from('☃', 'utf8');

    expect(readFrame([snowman.subarray(0, 1), snowman.subarray(1)])).toBe('☃');
  });

  it('reads an empty frame as an empty string', () => {
    expect(readFrame(Buffer.alloc(0))).toBe('');
  });
});
