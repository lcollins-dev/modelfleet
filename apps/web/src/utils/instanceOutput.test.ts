import { describe, expect, it } from 'vitest';

import type { InstanceOutputFrameDto, InstanceOutputLineDto } from '@libs/dto';
import { InstanceOutputEndReason } from '@libs/dto';

import { plainText } from './ansi';
import {
  IInstanceOutput,
  OUTPUT_LINE_CAP,
  applyOutputFrame,
  describeOutputRefusal,
  describeOutputSpan,
  emptyInstanceOutput,
} from './instanceOutput';

const NOW = new Date(2026, 9, 15, 16, 0, 0);

const line = (
  text: string,
  date: Date | null = new Date(2026, 9, 15, 14, 2, 11),
  cut = false
): InstanceOutputLineDto => ({
  date: date === null ? null : date.toISOString(),
  text,
  cut,
});

const lines = (count: number, from = 0): InstanceOutputLineDto[] =>
  Array.from({ length: count }, (_, index) => line(`line ${from + index}`));

const apply = (...frames: InstanceOutputFrameDto[]): IInstanceOutput =>
  frames.reduce(applyOutputFrame, emptyInstanceOutput());

const texts = (output: IInstanceOutput): string[] => output.lines.map(entry => plainText(entry.segments));

describe('applyOutputFrame', () => {
  it('starts the buffer afresh on every open, so a reconnect does not repeat the tail', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: false },
      { kind: 'lines', lines: [line('first')] },
      { kind: 'opened', tailLines: 1000, complete: true },
      { kind: 'lines', lines: [line('again')] }
    );

    expect(texts(output)).toEqual(['again']);
    expect(output.complete).toBe(true);
    expect(output.lines).toHaveLength(1);
  });

  it('keys every entry uniquely, across a reopen too', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: lines(2) },
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: lines(2) }
    );

    expect(output.lines.map(entry => entry.id)).toEqual([2, 3]);
  });

  it('reads each line with its local date, and none where the line carried no timestamp', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('stamped'), line('bare', null)] }
    );

    expect(output.lines[0].date).toEqual(new Date(2026, 9, 15, 14, 2, 11));
    expect(output.lines[1].date).toBeNull();
  });

  it('reads a line without its escape sequences', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('\u001b[33mWARNING\u001b[0m low memory\u001b[K')] }
    );

    expect(texts(output)).toEqual(['WARNING low memory']);
  });

  it('carries a colour left open into the next lines, across frames', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('\u001b[31mTraceback:'), line('  File "main.py"')] },
      { kind: 'lines', lines: [line('Error\u001b[0m'), line('after')] }
    );

    expect(output.lines.map(entry => entry.segments[0].style.tone)).toEqual(['red', 'red', 'red', null]);
  });

  it('starts plain on every open, whatever colour the last stream left open', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('\u001b[31mTraceback:')] },
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('fresh')] }
    );

    expect(output.lines[0].segments[0].style.tone).toBeNull();
  });

  it('keeps a cut line marked', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('x'.repeat(8192), null, true)] }
    );

    expect(output.lines[0].cut).toBe(true);
  });

  it('drops the oldest lines past the cap, counting them', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: true },
      { kind: 'lines', lines: lines(OUTPUT_LINE_CAP - 1) },
      { kind: 'lines', lines: lines(3, OUTPUT_LINE_CAP - 1) }
    );

    expect(output.lines).toHaveLength(OUTPUT_LINE_CAP);
    expect(output.dropped).toBe(2);
    expect(texts(output)[0]).toBe('line 2');
    expect(texts(output).at(-1)).toBe(`line ${OUTPUT_LINE_CAP + 1}`);
  });

  it('records the end and its reason without touching the lines', () => {
    const output = apply(
      { kind: 'opened', tailLines: 10, complete: false },
      { kind: 'lines', lines: [line('last words')] },
      { kind: 'ended', reason: InstanceOutputEndReason.LOST }
    );

    expect(output.ended).toBe(InstanceOutputEndReason.LOST);
    expect(texts(output)).toEqual(['last words']);
  });
});

describe('describeOutputSpan', () => {
  it('says nothing until the stream has opened', () => {
    expect(describeOutputSpan(emptyInstanceOutput(), NOW)).toBeNull();
  });

  it('reads a tail that reaches the start as the whole output, from its first line', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: true },
      { kind: 'lines', lines: [line('bare', null), line('stamped')] }
    );

    expect(describeOutputSpan(output, NOW)).toBe('Since the container started at 14:02:11');
  });

  it('reads a cut-off tail as the lines it asked for, from its first line', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: false },
      { kind: 'lines', lines: [line('stamped')] }
    );

    expect(describeOutputSpan(output, NOW)).toBe('Last 1,000 lines, since 14:02:11');
  });

  it('names the day of a first line from an earlier day', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: false },
      { kind: 'lines', lines: [line('stamped', new Date(2026, 9, 14, 23, 59, 1))] }
    );

    expect(describeOutputSpan(output, NOW)).toBe('Last 1,000 lines, since 14/10/26 23:59:01');
  });

  it('leaves out the time while no line carries one', () => {
    expect(describeOutputSpan(apply({ kind: 'opened', tailLines: 1000, complete: true }), NOW)).toBe(
      'Since the container started'
    );
    expect(describeOutputSpan(apply({ kind: 'opened', tailLines: 1000, complete: false }), NOW)).toBe(
      'Last 1,000 lines'
    );
  });

  it('reads the cap once it has dropped lines, since the start is no longer on screen', () => {
    const output = apply(
      { kind: 'opened', tailLines: 1000, complete: true },
      { kind: 'lines', lines: lines(OUTPUT_LINE_CAP + 1) }
    );

    expect(describeOutputSpan(output, NOW)).toBe('Last 5,000 lines, since 14:02:11');
  });
});

describe('describeOutputRefusal', () => {
  it("shows the api's own message for the refusals it words", () => {
    expect(describeOutputRefusal(409, "This instance's node is not connected, so its output cannot be read")).toBe(
      "This instance's node is not connected, so its output cannot be read."
    );
    expect(describeOutputRefusal(404, 'This instance does not exist')).toBe('This instance does not exist.');
  });

  it('shows a stock message for any other status, or a refusal with no message', () => {
    expect(describeOutputRefusal(500, 'Internal server error')).toBe(
      'The output could not be read. Try again in a moment.'
    );
    expect(describeOutputRefusal(502, null)).toBe('The output could not be read. Try again in a moment.');
  });

  it('adds no second full stop to a message that already ends with one', () => {
    expect(describeOutputRefusal(400, 'Enter a valid instance key.')).toBe('Enter a valid instance key.');
  });
});
