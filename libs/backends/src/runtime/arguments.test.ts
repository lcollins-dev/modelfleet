import { describe, expect, it } from 'vitest';

import { BackendFieldType } from '../configuration';
import { buildDeclaration } from '../test/declaration.factory';
import { declaredArguments } from './arguments';

const declaration = buildDeclaration();
const DECLARED_DEFAULTS = ['--ctx-size', '4096', '--split-mode', 'layer'];

describe('declaredArguments', () => {
  it('passes the declared default where the document has no key', () => {
    expect(declaredArguments(declaration, {})).toEqual(['--ctx-size', '4096', '--split-mode', 'layer']);
  });

  it('passes no flag for a field set to null', () => {
    expect(declaredArguments(declaration, { contextSize: null })).not.toContain('--ctx-size');
  });

  it('passes no flag for a field with neither a value nor a default', () => {
    expect(declaredArguments(declaration, {})).not.toContain('--rope-scale');
  });

  it('writes each type as the backend takes it', () => {
    const command = declaredArguments(declaration, {
      contextSize: 8192,
      ropeScale: 1.5,
      chatTemplate: 'chatml',
      splitMode: 'row',
      tensorSplit: [0.6, 0.4],
    });

    expect(command).toEqual([
      '--ctx-size',
      '8192',
      '--rope-scale',
      '1.5',
      '--chat-template',
      'chatml',
      '--split-mode',
      'row',
      '--tensor-split',
      '0.6,0.4',
    ]);
  });

  it('writes a model reference as the path the file is bound at, never the fingerprint', () => {
    const paths = new Map([['mmproj', '/models/mmproj/mmproj-F16.gguf']]);
    const command = declaredArguments(declaration, { mmproj: 'a'.repeat(64) }, paths);

    expect(command).toContain('--mmproj');
    expect(command).toContain('/models/mmproj/mmproj-F16.gguf');
    expect(command).not.toContain('a'.repeat(64));
  });

  it('passes no flag for a model reference the caller resolved no path for', () => {
    expect(declaredArguments(declaration, { mmproj: 'a'.repeat(64) })).not.toContain('--mmproj');
  });

  it('passes a boolean as a bare flag, and nothing where it is off with no off flag', () => {
    expect(declaredArguments(declaration, { mlock: true })).toContain('--mlock');
    expect(declaredArguments(declaration, { mlock: false })).not.toContain('--mlock');
  });

  it('passes the off flag where a field declares one', () => {
    const withOffFlag = buildDeclaration({
      fields: [
        {
          name: 'contBatching',
          flag: '--cont-batching',
          offFlag: '--no-cont-batching',
          label: 'Continuous batching',
          description: 'Lets a new request join a batch already running.',
          group: 'context',
          type: BackendFieldType.BOOLEAN,
          default: true,
        },
      ],
    });

    expect(declaredArguments(withOffFlag, {})).toEqual(['--cont-batching']);
    expect(declaredArguments(withOffFlag, { contBatching: false })).toEqual(['--no-cont-batching']);
  });

  it('appends extra flags after the declared fields', () => {
    const command = declaredArguments(declaration, { extraFlags: ['--ctx-size', '512', '--mirostat', '2'] });

    expect(command).toEqual([...DECLARED_DEFAULTS, '--ctx-size', '512', '--mirostat', '2']);
  });

  it.each([
    { name: 'a flag on its own', entries: ['--mlock'], expected: ['--mlock'] },
    { name: 'a flag already split over two entries', entries: ['--ctx-size', '512'], expected: ['--ctx-size', '512'] },
    {
      name: 'a flag and its value in one entry',
      entries: ['--split-mode tensor'],
      expected: ['--split-mode', 'tensor'],
    },
    {
      name: 'a double quoted value holding spaces',
      entries: ['--chat-template "{{ x }}"'],
      expected: ['--chat-template', '{{ x }}'],
    },
    {
      name: 'a single quoted value holding spaces',
      entries: ["--chat-template '{{ x }}'"],
      expected: ['--chat-template', '{{ x }}'],
    },
    {
      name: 'a quoted value in a flag joined by an equals sign',
      entries: ['--chat-template="{{ x }}"'],
      expected: ['--chat-template={{ x }}'],
    },
    {
      name: 'the same flag repeated across entries',
      entries: ['--lora first.gguf', '--lora second.gguf'],
      expected: ['--lora', 'first.gguf', '--lora', 'second.gguf'],
    },
    {
      name: 'an entry padded with whitespace',
      entries: ['  --split-mode\ttensor  '],
      expected: ['--split-mode', 'tensor'],
    },
    { name: 'an entry holding only whitespace', entries: ['   '], expected: [] },
    { name: 'an empty entry', entries: [''], expected: [] },
    { name: 'an explicitly empty quoted value', entries: ['--chat-template ""'], expected: ['--chat-template', ''] },
  ])('splits $name into the arguments it holds', ({ entries, expected }) => {
    expect(declaredArguments(declaration, { extraFlags: entries })).toEqual([...DECLARED_DEFAULTS, ...expected]);
  });

  it('carries no flag for a key the declaration does not model', () => {
    expect(declaredArguments(declaration, { unknownKey: 'value' })).toEqual([
      '--ctx-size',
      '4096',
      '--split-mode',
      'layer',
    ]);
  });

  it('passes no flag for a value of the wrong type, which validation reports separately', () => {
    expect(declaredArguments(declaration, { contextSize: 'wide' })).not.toContain('--ctx-size');
  });

  it('passes no flag for an empty list', () => {
    expect(declaredArguments(declaration, { tensorSplit: [] })).not.toContain('--tensor-split');
  });
});
