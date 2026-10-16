import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { deploymentName } from './deployment';

const messagesFor = (schema: z.ZodType, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map(issue => issue.message);
};

describe('deploymentName', () => {
  it('accepts the separators a model id carries', () => {
    expect(messagesFor(deploymentName(), 'Qwen/Qwen3-8B:q4_k.m')).toEqual([]);
  });

  it.each(['chat model', 'chat//8b', ':chat'])('refuses %j', value => {
    expect(messagesFor(deploymentName(), value)).toEqual([
      'Use only letters, numbers, hyphens, dots, underscores, slashes and colons, with no spaces.',
    ]);
  });
});
