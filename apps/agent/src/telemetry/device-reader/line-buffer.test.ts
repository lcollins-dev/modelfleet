import { describe, expect, it } from 'vitest';

import { LineBuffer } from '@/telemetry/device-reader/line-buffer';

describe('LineBuffer', () => {
  it('returns each complete line a chunk finished', () => {
    const buffer = new LineBuffer(1024);

    expect(buffer.push('one\ntwo\n')).toEqual(['one', 'two']);
  });

  it('holds a partial line until the chunk that finishes it', () => {
    const buffer = new LineBuffer(1024);

    expect(buffer.push('{"schema"')).toEqual([]);
    expect(buffer.push(':1}\n')).toEqual(['{"schema":1}']);
  });

  it('joins a line split across three chunks', () => {
    const buffer = new LineBuffer(1024);

    buffer.push('a');
    buffer.push('b');

    expect(buffer.push('c\n')).toEqual(['abc']);
  });

  it('drops the blank line a trailing newline leaves behind', () => {
    const buffer = new LineBuffer(1024);

    expect(buffer.push('one\n\n\ntwo\n')).toEqual(['one', 'two']);
  });

  it('refuses a line that runs past the cap', () => {
    const buffer = new LineBuffer(8);

    expect(() => buffer.push('123456789')).toThrow(RangeError);
  });

  it('starts clean after a refused line', () => {
    const buffer = new LineBuffer(8);

    expect(() => buffer.push('123456789')).toThrow(RangeError);
    expect(buffer.push('ok\n')).toEqual(['ok']);
  });

  it('forgets a partial line when reset', () => {
    const buffer = new LineBuffer(1024);

    buffer.push('partial');
    buffer.reset();

    expect(buffer.push('whole\n')).toEqual(['whole']);
  });
});
