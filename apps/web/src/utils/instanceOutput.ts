import type { InstanceOutputEndReason, InstanceOutputFrameDto, InstanceOutputLineDto } from '@libs/dto';

import { IAnsiSegment, IAnsiStyle, PLAIN_STYLE, parseAnsi } from './ansi';
import { formatDate, formatTime } from './format/date';
import { formatNumber } from './format/number';

export const OUTPUT_LINE_CAP = 5000;

const OWN_REFUSAL_STATUSES = [400, 404, 409, 502];

const STOCK_REFUSAL = 'The output could not be read. Try again in a moment.';

export interface IOutputLine {
  id: number;
  date: Date | null;
  segments: IAnsiSegment[];
  cut: boolean;
}

export interface IInstanceOutput {
  /** Null until the stream has opened. */
  tailLines: number | null;
  complete: boolean;
  lines: IOutputLine[];
  /** Lines dropped from the head to hold `OUTPUT_LINE_CAP`. */
  dropped: number;
  ended: InstanceOutputEndReason | null;
  nextId: number;
  /** The style the last line ended in, which the next line starts in. */
  style: IAnsiStyle;
}

export const emptyInstanceOutput = (nextId = 0): IInstanceOutput => ({
  tailLines: null,
  complete: false,
  lines: [],
  dropped: 0,
  ended: null,
  nextId,
  style: PLAIN_STYLE,
});

export const applyOutputFrame = (output: IInstanceOutput, frame: InstanceOutputFrameDto): IInstanceOutput => {
  if (frame.kind === 'opened') {
    return { ...emptyInstanceOutput(output.nextId), tailLines: frame.tailLines, complete: frame.complete };
  }

  if (frame.kind === 'ended') {
    return { ...output, ended: frame.reason };
  }

  const lines = [...output.lines];
  let style = output.style;

  for (const [index, line] of frame.lines.entries()) {
    const parsed = parseAnsi(line.text, style);

    lines.push(toOutputLine(line, output.nextId + index, parsed.segments));
    style = parsed.style;
  }

  const excess = Math.max(0, lines.length - OUTPUT_LINE_CAP);

  return {
    ...output,
    lines: excess === 0 ? lines : lines.slice(excess),
    dropped: output.dropped + excess,
    nextId: output.nextId + frame.lines.length,
    style,
  };
};

export const describeOutputSpan = (output: IInstanceOutput, now = new Date()): string | null => {
  if (output.tailLines === null) {
    return null;
  }

  const first = output.lines.find(line => line.date !== null)?.date ?? null;
  const since = first === null ? null : formatSince(first, now);

  if (output.complete && output.dropped === 0) {
    return since === null ? 'Since the container started' : `Since the container started at ${since}`;
  }

  const lines = `Last ${formatNumber(output.dropped > 0 ? OUTPUT_LINE_CAP : output.tailLines)} lines`;

  return since === null ? lines : `${lines}, since ${since}`;
};

/** The api words these statuses for the operator; any other may carry raw server text. */
export const describeOutputRefusal = (status: number, message: string | null): string => {
  if (!OWN_REFUSAL_STATUSES.includes(status) || message === null) {
    return STOCK_REFUSAL;
  }

  return message.endsWith('.') ? message : `${message}.`;
};

const toOutputLine = (line: InstanceOutputLineDto, id: number, segments: IAnsiSegment[]): IOutputLine => {
  const date = line.date === null ? null : new Date(line.date);

  return {
    id,
    date: date === null || Number.isNaN(date.getTime()) ? null : date,
    segments,
    cut: line.cut,
  };
};

const formatSince = (date: Date, now: Date): string =>
  formatDate(date) === formatDate(now) ? formatTime(date) : `${formatDate(date)} ${formatTime(date)}`;
