import { describe, expect, it } from 'vitest';

import { IAnsiSegment, IAnsiStyle, parseAnsi, plainText } from './ansi';

const ESC = '\u001b';

const PLAIN: IAnsiStyle = { tone: null, bold: false, dim: false, italic: false, underline: false };

const styled = (overrides: Partial<IAnsiStyle>): IAnsiStyle => ({ ...PLAIN, ...overrides });

const segmentsOf = (text: string): IAnsiSegment[] => parseAnsi(text).segments;

const shown = (text: string): string => plainText(segmentsOf(text));

describe('parseAnsi', () => {
  it('reads a vLLM-Omni line as its coloured parts', () => {
    const line =
      `${ESC}[0;36m(StageEngineCoreProc_stage0_replica0 pid=220)${ESC}[0;0m ${ESC}[32mINFO${ESC}[0m ` +
      `${ESC}[90m10-15 20:11:17${ESC}[0m [core.py:93] Initializing a V1 LLM engine`;

    expect(segmentsOf(line)).toEqual([
      { text: '(StageEngineCoreProc_stage0_replica0 pid=220)', style: styled({ tone: 'cyan' }) },
      { text: ' ', style: PLAIN },
      { text: 'INFO', style: styled({ tone: 'green' }) },
      { text: ' ', style: PLAIN },
      { text: '10-15 20:11:17', style: styled({ tone: 'black' }) },
      { text: ' [core.py:93] Initializing a V1 LLM engine', style: PLAIN },
    ]);
  });

  it("reads vLLM's coloured banner line, ended by a carriage return", () => {
    const line =
      `${ESC}[0;36m(APIServer pid=1)${ESC}[0;0m ${ESC}[32mINFO${ESC}[0m ${ESC}[90m10-15 20:25:15${ESC}[0m ` +
      `${ESC}[90m[api_utils.py:347]${ESC}[0m  ${ESC}[93m▄▄${ESC}[0m ${ESC}[94m▄█${ESC}[0m ` +
      `${ESC}[1m█     █     █ ▀▄▀ █${ESC}[0m  version ${ESC}[1m0.31.0${ESC}[0m\r`;

    const segments = segmentsOf(line);

    expect(plainText(segments)).toBe(
      '(APIServer pid=1) INFO 10-15 20:25:15 [api_utils.py:347]  ▄▄ ▄█ █     █     █ ▀▄▀ █  version 0.31.0'
    );
    expect(segments.find(segment => segment.text === '▄▄')?.style).toEqual(styled({ tone: 'yellow' }));
    expect(segments.find(segment => segment.text === '▄█')?.style).toEqual(styled({ tone: 'blue' }));
    expect(segments.at(-1)).toEqual({ text: '0.31.0', style: styled({ bold: true }) });
  });

  it('shows a plain line as one plain segment', () => {
    expect(segmentsOf('INFO 10-15 20:11:17 [api_server.py:1] Starting\tserver')).toEqual([
      { text: 'INFO 10-15 20:11:17 [api_server.py:1] Starting\tserver', style: PLAIN },
    ]);
  });

  it('shows nothing for an empty line', () => {
    expect(segmentsOf('')).toEqual([]);
  });

  it('leaves the plain style untouched when a reset precedes an extended colour', () => {
    segmentsOf(`${ESC}[0;38;5;208mx`);

    expect(segmentsOf('y')[0].style).toEqual(PLAIN);
  });

  it('maps every base and bright foreground to its tone', () => {
    const tones = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

    tones.forEach((tone, index) => {
      expect(segmentsOf(`${ESC}[${30 + index}mx`)[0].style.tone).toBe(tone);
      expect(segmentsOf(`${ESC}[${90 + index}mx`)[0].style.tone).toBe(tone);
    });
  });

  it('applies and clears bold, dim, italic and underline', () => {
    expect(segmentsOf(`${ESC}[1;2;3;4ma${ESC}[22mb${ESC}[23;24mc`)).toEqual([
      { text: 'a', style: styled({ bold: true, dim: true, italic: true, underline: true }) },
      { text: 'b', style: styled({ italic: true, underline: true }) },
      { text: 'c', style: PLAIN },
    ]);
  });

  it('resets on an empty parameter list and on 39 for the colour alone', () => {
    expect(segmentsOf(`${ESC}[1;31ma${ESC}[39mb${ESC}[mc`)).toEqual([
      { text: 'a', style: styled({ tone: 'red', bold: true }) },
      { text: 'b', style: styled({ bold: true }) },
      { text: 'c', style: PLAIN },
    ]);
  });

  it('takes a 256-colour or true-colour foreground as the surrounding colour, and skips its parameters', () => {
    expect(segmentsOf(`${ESC}[31;38;5;208;1ma${ESC}[0;31;38;2;255;0;0mb${ESC}[31;38:5:208mc`)).toEqual([
      { text: 'a', style: styled({ bold: true }) },
      { text: 'bc', style: PLAIN },
    ]);
  });

  it('skips an underline colour and its parameters', () => {
    expect(segmentsOf(`${ESC}[31;58;5;4mx${ESC}[58;2;1;2;3my${ESC}[58:2::1:2:3mz`)).toEqual([
      { text: 'xyz', style: styled({ tone: 'red' }) },
    ]);
  });

  it('reads an underline kind given with a colon, `4:0` as off', () => {
    expect(segmentsOf(`${ESC}[4:3ma${ESC}[4:0mb`)).toEqual([
      { text: 'a', style: styled({ underline: true }) },
      { text: 'b', style: PLAIN },
    ]);
  });

  it('ignores backgrounds, their extended parameters included', () => {
    expect(segmentsOf(`${ESC}[41;32mx${ESC}[48;5;1;4my${ESC}[48;2;0;0;0;49mz`)).toEqual([
      { text: 'x', style: styled({ tone: 'green' }) },
      { text: 'yz', style: styled({ tone: 'green', underline: true }) },
    ]);
  });

  it('merges neighbouring text of the same style', () => {
    expect(segmentsOf(`${ESC}[32ma${ESC}[32mb${ESC}[1m${ESC}[22mc`)).toEqual([
      { text: 'abc', style: styled({ tone: 'green' }) },
    ]);
  });

  it('drops cursor movement, line clearing and other control sequences', () => {
    expect(shown(`${ESC}[2K${ESC}[1Gloading${ESC}[3A${ESC}[?25l done${ESC}[?25h${ESC}[0J`)).toBe('loading done');
  });

  it('drops an operating system command ended by BEL or by the string terminator', () => {
    expect(shown(`${ESC}]0;vllm serve\u0007a${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\`)).toBe(
      'alink'
    );
  });

  it('drops device control strings and two-character escapes', () => {
    expect(shown(`${ESC}Pq#0;2;0;0;0${ESC}\\a${ESC}(Bb${ESC}7c${ESC}8`)).toBe('abc');
  });

  it('ends an unterminated operating system command at the next escape, which still applies', () => {
    expect(segmentsOf(`${ESC}]0;title${ESC}[31mred`)).toEqual([{ text: 'red', style: styled({ tone: 'red' }) }]);
  });

  it('reads the 8-bit control sequence introducer as an escape', () => {
    expect(segmentsOf('\u009b31mERROR\u009b0m \u009b2Kdone')).toEqual([
      { text: 'ERROR', style: styled({ tone: 'red' }) },
      { text: ' done', style: PLAIN },
    ]);
  });

  it('erases the character before a backspace, across styles but not past the line', () => {
    expect(shown('|\b/\b-')).toBe('-');
    expect(segmentsOf(`ab${ESC}[31mc\b\b\bd`)).toEqual([{ text: 'd', style: styled({ tone: 'red' }) }]);
    expect(shown('one\n\btwo')).toBe('one\ntwo');
  });

  it('drops a sequence cut off at the end of the line', () => {
    expect(shown(`INFO ${ESC}[0;3`)).toBe('INFO ');
    expect(shown(`INFO ${ESC}`)).toBe('INFO ');
    expect(shown(`INFO ${ESC}]0;title`)).toBe('INFO ');
  });

  it('keeps the text after a malformed control sequence', () => {
    expect(shown(`a${ESC}[1\u0001b`)).toBe('ab');
  });

  it('drops control characters other than tabs and newlines', () => {
    expect(shown('a\u0007b\u0000c\u007fd\u0085e')).toBe('abcde');
  });

  it('shows only the text after the last carriage return, keeping its style', () => {
    expect(segmentsOf(`${ESC}[32m 10%\r 50%\r100%${ESC}[0m done`)).toEqual([
      { text: '100%', style: styled({ tone: 'green' }) },
      { text: ' done', style: PLAIN },
    ]);
  });

  it('ignores a carriage return that ends the line', () => {
    expect(shown('Loading weights\r')).toBe('Loading weights');
    expect(shown(`Loading weights\r${ESC}[0m`)).toBe('Loading weights');
  });

  it('replaces only the line a carriage return sits on in multi-line text', () => {
    expect(shown('first\r\nsecond 1/3\rsecond 3/3\nthird')).toBe('first\nsecond 3/3\nthird');
  });

  it('starts in the given style and returns the one it ends in', () => {
    const first = parseAnsi(`${ESC}[1;31mTraceback:`);
    const second = parseAnsi('  File "main.py"', first.style);
    const third = parseAnsi(`${ESC}[0mafter`, second.style);

    expect(second.segments).toEqual([{ text: '  File "main.py"', style: styled({ tone: 'red', bold: true }) }]);
    expect(third.segments).toEqual([{ text: 'after', style: PLAIN }]);
    expect(third.style).toEqual(PLAIN);
  });

  it('carries a style across lines in multi-line text', () => {
    expect(segmentsOf(`${ESC}[31mError:\n  detail${ESC}[0m`)).toEqual([
      { text: 'Error:\n', style: styled({ tone: 'red' }) },
      { text: '  detail', style: styled({ tone: 'red' }) },
    ]);
  });
});
