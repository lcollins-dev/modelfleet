import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';

import { FirstByteMeter } from './first-byte-meter';

describe('FirstByteMeter', () => {
  it('passes every byte through untouched', async () => {
    const bytes = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x0a, 0x0a]);
    const meter = new FirstByteMeter();

    const out = await buffer(Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]).pipe(meter));

    expect(out.equals(bytes)).toBe(true);
  });

  it('marks the first byte, and nothing for a stream that carried none', async () => {
    const carried = new FirstByteMeter();
    const empty = new FirstByteMeter();

    await buffer(Readable.from([Buffer.from('a')]).pipe(carried));
    await buffer(Readable.from([]).pipe(empty));

    expect(carried.firstPayloadAt).not.toBeNull();
    expect(empty.firstPayloadAt).toBeNull();
  });
});
