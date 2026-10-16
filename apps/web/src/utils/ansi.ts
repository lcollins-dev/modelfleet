const ESC = '\u001b';
const BEL = '\u0007';

/** The 8-bit form of `ESC [`. */
const CSI = '\u009b';

export type AnsiTone = 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';

const TONES: AnsiTone[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

export interface IAnsiStyle {
  /** Null keeps the colour of the text around it. */
  tone: AnsiTone | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
}

export interface IAnsiSegment {
  text: string;
  style: IAnsiStyle;
}

export interface IAnsiText {
  segments: IAnsiSegment[];
  /** The style in effect at the end, which a terminal carries on into the next line. */
  style: IAnsiStyle;
}

interface IEscape {
  end: number;
  /** The parameters of a colour and style sequence, null for any other. */
  sgr: string[] | null;
}

export const PLAIN_STYLE: IAnsiStyle = { tone: null, bold: false, dim: false, italic: false, underline: false };

/**
 * Keeps colour and style and drops every other escape and control character. A carriage return replaces its line, and
 * a backspace erases the character before it.
 */
export const parseAnsi = (text: string, from: IAnsiStyle = PLAIN_STYLE): IAnsiText => {
  const segments: IAnsiSegment[] = [];

  let style = from;
  let run = '';
  let lineStart = 0;
  let returned = false;

  const flush = () => {
    if (run === '') {
      return;
    }

    const last = segments.at(-1);

    if (last !== undefined && segments.length > lineStart && sameStyle(last.style, style)) {
      last.text += run;
    } else {
      segments.push({ text: run, style });
    }

    run = '';
  };

  const erase = () => {
    if (run !== '') {
      run = run.slice(0, -1);
      return;
    }

    const last = segments.at(-1);

    if (last === undefined || segments.length <= lineStart) {
      return;
    }

    last.text = last.text.slice(0, -1);

    if (last.text === '') {
      segments.pop();
    }
  };

  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === ESC || char === CSI) {
      const escape = readEscape(text, index);

      if (escape.sgr !== null) {
        flush();
        style = applySgr(style, escape.sgr);
      }

      index = escape.end;
      continue;
    }

    if (char === '\n') {
      run += char;
      flush();
      lineStart = segments.length;
      returned = false;
    } else if (char === '\r') {
      returned = true;
    } else if (char === '\b') {
      if (!returned) {
        erase();
      }
    } else if (isShown(char)) {
      if (returned) {
        run = '';
        segments.length = lineStart;
        returned = false;
      }

      run += char;
    }

    index++;
  }

  flush();

  return { segments, style };
};

export const plainText = (segments: IAnsiSegment[]): string => segments.map(segment => segment.text).join('');

const sameStyle = (first: IAnsiStyle, second: IAnsiStyle): boolean =>
  first.tone === second.tone &&
  first.bold === second.bold &&
  first.dim === second.dim &&
  first.italic === second.italic &&
  first.underline === second.underline;

const isShown = (char: string): boolean => {
  const code = char.charCodeAt(0);

  return char === '\t' || (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f));
};

const inRange = (char: string | undefined, low: number, high: number): boolean => {
  if (char === undefined) {
    return false;
  }

  const code = char.charCodeAt(0);

  return code >= low && code <= high;
};

const readEscape = (text: string, start: number): IEscape => {
  if (text[start] === CSI) {
    return readControlSequence(text, start + 1);
  }

  const kind = text[start + 1];

  if (kind === '[') {
    return readControlSequence(text, start + 2);
  }

  if (kind === ']') {
    return { end: stringEnd(text, start + 2, true), sgr: null };
  }

  if (kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
    return { end: stringEnd(text, start + 2, false), sgr: null };
  }

  let index = start + 1;

  while (inRange(text[index], 0x20, 0x2f)) {
    index++;
  }

  return { end: inRange(text[index], 0x30, 0x7e) ? index + 1 : index, sgr: null };
};

const readControlSequence = (text: string, from: number): IEscape => {
  let index = from;

  while (inRange(text[index], 0x30, 0x3f)) {
    index++;
  }

  const parameters = text.slice(from, index);

  while (inRange(text[index], 0x20, 0x2f)) {
    index++;
  }

  if (!inRange(text[index], 0x40, 0x7e)) {
    return { end: index, sgr: null };
  }

  const isSgr = text[index] === 'm' && /^[\d;:]*$/.test(parameters);

  return { end: index + 1, sgr: isSgr ? parameters.split(';') : null };
};

/** An OSC may also end on BEL. Any other escape cuts the string short and starts a sequence of its own. */
const stringEnd = (text: string, from: number, endsOnBell: boolean): number => {
  for (let index = from; index < text.length; index++) {
    if (endsOnBell && text[index] === BEL) {
      return index + 1;
    }

    if (text[index] === ESC) {
      return text[index + 1] === '\\' ? index + 2 : index;
    }
  }

  return text.length;
};

/** A bright colour takes its base tone. A 256-colour or true-colour foreground has no token, so it resets the tone. */
const applySgr = (style: IAnsiStyle, parameters: string[]): IAnsiStyle => {
  let next = style;

  for (let index = 0; index < parameters.length; index++) {
    const [base, ...subparameters] = parameters[index].split(':');
    const code = base === '' ? 0 : Number.parseInt(base, 10);

    // With colons a foreground, background or underline colour is one parameter, such as `38:5:208`.
    if (code === 38 || code === 48 || code === 58) {
      if (code === 38) {
        next = { ...next, tone: null };
      }

      if (subparameters.length === 0) {
        index += extendedColourLength(parameters[index + 1]);
      }

      continue;
    }

    // `4:0` is underline off. Any other `4:n` is a kind of underline.
    if (code === 4 && subparameters.length > 0) {
      next = { ...next, underline: subparameters[0] !== '0' };
      continue;
    }

    next = applyCode(next, code);
  }

  return next;
};

const extendedColourLength = (mode: string | undefined): number => {
  if (mode === '5') {
    return 2;
  }

  return mode === '2' ? 4 : 0;
};

const applyCode = (style: IAnsiStyle, code: number): IAnsiStyle => {
  if (code === 0) {
    return PLAIN_STYLE;
  }

  if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
    return { ...style, tone: TONES[code % 10] };
  }

  switch (code) {
    case 1:
      return { ...style, bold: true };
    case 2:
      return { ...style, dim: true };
    case 3:
      return { ...style, italic: true };
    case 4:
      return { ...style, underline: true };
    case 22:
      return { ...style, bold: false, dim: false };
    case 23:
      return { ...style, italic: false };
    case 24:
      return { ...style, underline: false };
    case 39:
      return { ...style, tone: null };
    default:
      return style;
  }
};
