import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { parseAnsi } from '@/utils/ansi';

import OutputText from './OutputText.vue';

const ESC = '\u001b';

const classesOf = (text: string): string[][] =>
  mount(OutputText, { props: { segments: parseAnsi(text).segments } })
    .findAll('span > span')
    .map(span => span.classes());

describe('MfInstanceOutputText', () => {
  it('maps each colour onto its theme token', () => {
    const colours = [30, 31, 32, 33, 34, 35, 36, 37].map(code => `${ESC}[${code}m${code}`).join('');

    expect(classesOf(colours)).toEqual([
      ['text-muted'],
      ['text-error'],
      ['text-success'],
      ['text-warning'],
      ['text-series-1'],
      ['text-series-7'],
      ['text-accent'],
      ['text-header'],
    ]);
  });

  it('marks bold, dim, italic and underline, and leaves plain text to the colour around it', () => {
    expect(classesOf(`${ESC}[1ma${ESC}[22;2mb${ESC}[22;3mc${ESC}[23;4md${ESC}[0me`)).toEqual([
      ['font-semibold'],
      ['opacity-70'],
      ['italic'],
      ['underline'],
      [],
    ]);
  });

  it('keeps the text exactly, its whitespace included', () => {
    const wrapper = mount(OutputText, { props: { segments: parseAnsi(`  a${ESC}[31m b \t${ESC}[0mc  `).segments } });

    expect(wrapper.get('span').element.textContent).toBe('  a b \tc  ');
  });
});
