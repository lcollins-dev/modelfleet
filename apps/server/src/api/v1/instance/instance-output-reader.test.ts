import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceOutputEndReason, InstanceOutputFrameDto } from '@libs/dto';

import { InstanceOutputReader } from './instance-output-reader';

const STAMP = '2026-10-15T14:02:11.123456789Z';

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('InstanceOutputReader', () => {
  let reader: InstanceOutputReader;

  const linesOf = (frame: InstanceOutputFrameDto | null | undefined) => (frame?.kind === 'lines' ? frame.lines : []);

  const textsOf = (frame: InstanceOutputFrameDto | null | undefined) => linesOf(frame).map(line => line.text);

  beforeEach(() => {
    reader = new InstanceOutputReader();
  });

  describe('lines', () => {
    it('joins a line split across two chunks', () => {
      reader.write(Buffer.from(`${STAMP} --api-key sk-live`));
      reader.write(Buffer.from('-9f2a7c41 loaded\n'));

      expect(linesOf(reader.flush())).toEqual([
        { date: '2026-10-15T14:02:11.123Z', text: '--api-key sk-live-9f2a7c41 loaded', cut: false },
      ]);
    });

    it('decodes a character split across chunks', () => {
      const bytes = Buffer.from('loading ☀ weights\n');
      const split = bytes.indexOf(0xe2) + 1;

      reader.write(bytes.subarray(0, split));
      reader.write(bytes.subarray(split));

      expect(textsOf(reader.flush())).toEqual(['loading ☀ weights']);
    });

    it('carries a partial line until its newline arrives', () => {
      reader.write(Buffer.from('first\nsec'));

      expect(textsOf(reader.flush())).toEqual(['first']);

      reader.write(Buffer.from('ond\n'));

      expect(textsOf(reader.flush())).toEqual(['second']);
    });

    it('drops the carriage return a terminal writes before the newline', () => {
      reader.write(Buffer.from(`${STAMP} ready\r\n`));

      expect(textsOf(reader.flush())).toEqual(['ready']);
    });

    it('reads a timestamp whose fraction Docker trimmed away', () => {
      reader.write(Buffer.from('2026-10-15T14:02:11Z ready\n2026-10-15T14:02:12.5+01:00 serving\n'));

      expect(linesOf(reader.flush()).map(line => line.date)).toEqual([
        '2026-10-15T14:02:11.000Z',
        '2026-10-15T13:02:12.500Z',
      ]);
    });

    it('reads a line without a timestamp as undated and whole', () => {
      reader.write(Buffer.from('no stamp here\n'));

      expect(linesOf(reader.flush())).toEqual([{ date: null, text: 'no stamp here', cut: false }]);
    });

    it('keeps an empty line, since a blank line is part of the output', () => {
      reader.write(Buffer.from(`${STAMP} \n`));

      expect(linesOf(reader.flush())).toEqual([{ date: '2026-10-15T14:02:11.123Z', text: '', cut: false }]);
    });

    it('cuts a line past 8192 characters, marking it cut', () => {
      reader.write(Buffer.from(`${'a'.repeat(8192)}\n${'b'.repeat(8193)}\n`));

      const [whole, long] = linesOf(reader.flush());

      expect(whole).toMatchObject({ cut: false });
      expect(whole.text).toHaveLength(8192);
      expect(long).toMatchObject({ cut: true });
      expect(long.text).toBe('b'.repeat(8192));
    });

    it('splits a line that never ends once it passes 64K characters, and reads on from there', () => {
      reader.write(Buffer.from('x'.repeat(70 * 1024)));
      reader.write(Buffer.from('y'.repeat(1024)));
      reader.write(Buffer.from('z\nnext\n'));

      const lines = linesOf(reader.flush());

      expect(lines.map(line => [line.text.slice(0, 1), line.text.length, line.cut])).toEqual([
        ['x', 8192, true],
        ['y', 1025, false],
        ['n', 4, false],
      ]);
    });
  });

  describe('windows', () => {
    it('sends everything pending as one frame, then starts the next window empty', () => {
      reader.write(Buffer.from('one\ntwo\n'));

      expect(reader.flush()).toEqual({
        kind: 'lines',
        lines: [
          { date: null, text: 'one', cut: false },
          { date: null, text: 'two', cut: false },
        ],
      });

      reader.write(Buffer.from('three\n'));

      expect(textsOf(reader.flush())).toEqual(['three']);
    });

    it('sends no frame for a window that holds no whole line', () => {
      expect(reader.flush()).toBeNull();

      reader.write(Buffer.from('partial'));

      expect(reader.flush()).toBeNull();
    });

    it('flushes a partial line left at the end, then ends with the container having exited', () => {
      reader.write(Buffer.from('first\nlast words'));

      expect(reader.end()).toEqual([
        {
          kind: 'lines',
          lines: [
            { date: null, text: 'first', cut: false },
            { date: null, text: 'last words', cut: false },
          ],
        },
        { kind: 'ended', reason: InstanceOutputEndReason.EXITED },
      ]);
    });

    it('ends without a lines frame when nothing is pending', () => {
      expect(reader.end()).toEqual([{ kind: 'ended', reason: InstanceOutputEndReason.EXITED }]);
    });
  });

  describe('frames', () => {
    let body: PassThrough;
    let viewer: Writable;
    let seen: InstanceOutputFrameDto[];
    let completed: boolean;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

      body = new PassThrough();
      viewer = new Writable({ write: (_chunk, _encoding, callback) => callback() });
      seen = [];
      completed = false;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const subscribe = () =>
      reader.frames(body, viewer).subscribe({ next: frame => seen.push(frame), complete: () => (completed = true) });

    it('sends what arrived in each 250 ms window as one frame, and none for an empty window', async () => {
      subscribe();

      body.write('one\n');
      body.write('two\n');
      await settle();

      expect(seen).toEqual([]);

      vi.advanceTimersByTime(250);

      expect(seen.map(textsOf)).toEqual([['one', 'two']]);

      vi.advanceTimersByTime(250);

      expect(seen).toHaveLength(1);
    });

    it('stops reading the body while more than 1 MiB is pending, and reads on after a send', async () => {
      subscribe();

      body.write(`${'a'.repeat(1023)}\n`.repeat(1100));
      await settle();

      expect(body.isPaused()).toBe(true);

      body.write('after\n');
      await settle();
      vi.advanceTimersByTime(250);

      expect(linesOf(seen[0])).toHaveLength(1100);
      expect(body.isPaused()).toBe(false);

      await settle();
      vi.advanceTimersByTime(250);

      expect(textsOf(seen[1])).toEqual(['after']);
    });

    it("stops reading the body while the viewer's response needs a drain, and reads on once it drains", async () => {
      let release: () => void = () => {};

      viewer = new Writable({
        highWaterMark: 1,
        write: (_chunk, _encoding, callback) => {
          release = callback;
        },
      });
      viewer.write('x');

      subscribe();

      body.write('first\n');
      await settle();

      expect(body.isPaused()).toBe(true);

      body.write('second\n');
      await settle();
      vi.advanceTimersByTime(250);

      expect(seen.map(textsOf)).toEqual([['first']]);
      expect(body.isPaused()).toBe(true);

      release();
      await settle();

      expect(body.isPaused()).toBe(false);

      vi.advanceTimersByTime(250);

      expect(seen.map(textsOf)).toEqual([['first'], ['second']]);
    });

    it('flushes, then ends, when the body ends', async () => {
      subscribe();

      body.end('last');
      await settle();

      expect(seen).toEqual([
        { kind: 'lines', lines: [{ date: null, text: 'last', cut: false }] },
        { kind: 'ended', reason: InstanceOutputEndReason.EXITED },
      ]);
      expect(completed).toBe(true);
    });

    it('destroys the body when the viewer goes', () => {
      subscribe().unsubscribe();

      expect(body.destroyed).toBe(true);
    });
  });
});
