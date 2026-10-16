import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { nodeName } from './node';

const messagesFor = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map(issue => issue.message);
};

describe('nodeName', () => {
  it('accepts lowercase letters and numbers joined by hyphens and dots', () => {
    expect(messagesFor(nodeName(), 'gpu-01.lab')).toEqual([]);
  });

  it.each(['GPU-01', 'gpu 01', 'gpu--01', '-gpu', 'gpu_01'])('refuses %j', value => {
    expect(messagesFor(nodeName(), value)).toEqual([
      'Use only lowercase letters, numbers, hyphens and dots, with no spaces.',
    ]);
  });

  it('names the length limits for a name too short', () => {
    expect(messagesFor(nodeName(), 'a')).toEqual(['Enter between 2 and 128 characters.']);
  });
});
