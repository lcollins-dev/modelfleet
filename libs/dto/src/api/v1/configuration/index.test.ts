import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { configurationText } from '.';

const messagesFor = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map(issue => issue.message);
};

describe('configurationText', () => {
  it('accepts an empty document', () => {
    expect(messagesFor(configurationText(), '')).toEqual([]);
  });

  it('refuses a document over the limit', () => {
    expect(messagesFor(configurationText(), 'x'.repeat(64_001))).toEqual(['Enter no more than 64000 characters.']);
  });
});
