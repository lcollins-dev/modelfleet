import { describe, expect, it } from 'vitest';

import { BackendField, BackendFieldType } from '@libs/backends';
import type { ConfigurationValue } from '@libs/dto';

import {
  ConfigurationFormValue,
  describeConfigurationValue,
  describeDefault,
  describeImageDefault,
  readFieldValues,
  tidyListText,
  writeFieldValues,
} from './fields';

const field = (overrides: Partial<BackendField>): BackendField =>
  ({
    name: 'threads',
    label: 'Threads',
    description: 'Threads used for generation.',
    group: 'cpu',
    type: BackendFieldType.INTEGER,
    ...overrides,
  }) as BackendField;

const read = (type: BackendFieldType, value: ConfigurationValue) =>
  readFieldValues([field({ type })], { threads: value }).threads;

const write = (type: BackendFieldType, value: ConfigurationFormValue) =>
  writeFieldValues([field({ type })], { threads: value }).threads;

const FINGERPRINT = 'a'.repeat(64);

describe('readFieldValues', () => {
  it('reads a number straight through', () => {
    expect(read(BackendFieldType.INTEGER, 16)).toBe(16);
  });

  it('reads a model reference as the fingerprint the document holds', () => {
    expect(read(BackendFieldType.MODEL_REFERENCE, FINGERPRINT)).toBe(FINGERPRINT);
  });

  it('reads a number list as the text its control holds', () => {
    expect(read(BackendFieldType.NUMBER_LIST, [0.6, 0.4])).toBe('0.6, 0.4');
  });

  it('reads a text list one entry per line', () => {
    expect(read(BackendFieldType.TEXT_LIST, ['--mlock', '--no-mmap'])).toBe('--mlock\n--no-mmap');
  });

  it('reads a key the document does not hold as an empty control', () => {
    expect(readFieldValues([field({ type: BackendFieldType.BOOLEAN })], {}).threads).toBeNull();
  });

  it('reads a value of the wrong type as an empty control', () => {
    expect(read(BackendFieldType.INTEGER, 'sixteen')).toBeNull();
  });

  it('reads every declared field, so the form holds a control for each', () => {
    const fields = [field({ name: 'threads' }), field({ name: 'parallel' })];

    expect(Object.keys(readFieldValues(fields, { threads: 16 }))).toEqual(['threads', 'parallel']);
  });
});

describe('writeFieldValues', () => {
  it('writes an empty control as no key at all', () => {
    expect(write(BackendFieldType.INTEGER, null)).toBeUndefined();
  });

  it('writes an empty text control as no key at all', () => {
    expect(write(BackendFieldType.TEXT, '')).toBeUndefined();
  });

  it('writes a model reference as the fingerprint, and an empty picker as no key at all', () => {
    expect(write(BackendFieldType.MODEL_REFERENCE, FINGERPRINT)).toBe(FINGERPRINT);
    expect(write(BackendFieldType.MODEL_REFERENCE, null)).toBeUndefined();
  });

  it('writes false rather than dropping the key', () => {
    expect(write(BackendFieldType.BOOLEAN, false)).toBe(false);
  });

  it('writes a cleared number list as no key at all', () => {
    expect(write(BackendFieldType.NUMBER_LIST, '')).toBeUndefined();
  });

  it('writes a cleared text list as no key at all', () => {
    expect(write(BackendFieldType.TEXT_LIST, '  \n  ')).toBeUndefined();
  });

  it('splits a number list on commas and whitespace alike', () => {
    expect(write(BackendFieldType.NUMBER_LIST, '0.6, 0.4 0.2')).toEqual([0.6, 0.4, 0.2]);
  });

  it('carries a non-numeric list entry through as text', () => {
    expect(write(BackendFieldType.NUMBER_LIST, '0.6, half')).toEqual([0.6, 'half']);
  });

  it('splits a text list on lines and drops the blank ones', () => {
    expect(write(BackendFieldType.TEXT_LIST, '--mlock\n\n  --no-mmap  ')).toEqual(['--mlock', '--no-mmap']);
  });

  it('names a field the form holds no value for, so the key leaves the document', () => {
    expect(writeFieldValues([field({ name: 'threads' })], {})).toEqual({ threads: undefined });
  });
});

describe('tidyListText', () => {
  const numberList = field({ type: BackendFieldType.NUMBER_LIST });
  const textList = field({ type: BackendFieldType.TEXT_LIST });

  it('rewrites a number list as the list it saves', () => {
    expect(tidyListText(numberList, '0.9,1 ,1')).toBe('0.9, 1, 1');
  });

  it('settles a half-typed number list on the numbers it holds so far', () => {
    expect(tidyListText(numberList, '0.')).toBe('0');
    expect(tidyListText(numberList, '1,')).toBe('1');
    expect(tidyListText(numberList, '1, ')).toBe('1');
  });

  it('drops the blank lines and padding from a text list', () => {
    expect(tidyListText(textList, '--mlock\n\n  --no-mmap  \n')).toBe('--mlock\n--no-mmap');
  });

  it('reads an empty control as no value at all', () => {
    expect(tidyListText(numberList, '')).toBeNull();
    expect(tidyListText(numberList, null)).toBeNull();
    expect(tidyListText(textList, '  \n  ')).toBeNull();
  });
});

describe('describeDefault', () => {
  it('names the declared default', () => {
    expect(describeDefault(field({ type: BackendFieldType.INTEGER, default: 2048 }))).toBe('2048');
  });

  it("says a model reference has no default, since a fingerprint is one fleet's own", () => {
    expect(describeDefault(field({ type: BackendFieldType.MODEL_REFERENCE }))).toBe('none');
  });

  it('leaves a field with no default to the backend', () => {
    expect(describeDefault(field({ type: BackendFieldType.INTEGER }))).toBe('the backend decides');
  });
});

describe('describeImageDefault', () => {
  it('describes nothing where every variant names one image, which the field declares as its default', () => {
    expect(describeImageDefault({ cuda: 'llama:server', cpu: 'llama:server' })).toBeUndefined();
  });

  it('names each variant where they differ, since the one shown must be the one that runs', () => {
    expect(describeImageDefault({ cpu: 'vllm:cpu', cuda: 'vllm:cuda' })).toBe(
      'vllm:cuda on NVIDIA GPUs, vllm:cpu on CPU only'
    );
  });
});

describe('describeConfigurationValue', () => {
  it('reads a boolean as the control does', () => {
    expect(describeConfigurationValue(true)).toBe('On');
    expect(describeConfigurationValue(false)).toBe('Off');
  });

  it('joins a list', () => {
    expect(describeConfigurationValue([1, 2])).toBe('1, 2');
  });

  it('names a null value rather than reading it as unset', () => {
    expect(describeConfigurationValue(null)).toBe('null');
  });
});
