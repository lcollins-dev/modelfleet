import { describe, expect, it } from 'vitest';

import { buildDeclaration } from '../test/declaration.factory';
import { configurationSchema } from './document';

const declaration = buildDeclaration();
const FINGERPRINT = 'a'.repeat(64);

describe('configurationSchema', () => {
  it('parses a document setting every field', () => {
    const document = {
      contextSize: 8192,
      ropeScale: 1.5,
      mlock: true,
      chatTemplate: 'chatml',
      splitMode: 'row',
      tensorSplit: [0.6, 0.4],
      mmproj: FINGERPRINT,
      extraFlags: ['--no-warmup'],
    };

    expect(configurationSchema(declaration).parse(document)).toEqual(document);
  });

  it('keeps the keys the declaration does not model', () => {
    const parsed = configurationSchema(declaration).parse({ contextSize: 8192, draftModel: 'qwen' });

    expect(parsed).toEqual({ contextSize: 8192, draftModel: 'qwen' });
  });

  it('accepts a field left out, so it may inherit', () => {
    expect(configurationSchema(declaration).parse({})).toEqual({});
  });

  it('accepts null, the value that passes no flag at all', () => {
    const document = { contextSize: null, splitMode: null, tensorSplit: null };

    expect(configurationSchema(declaration).parse(document)).toEqual(document);
  });

  it('rejects a document a field is wrong in', () => {
    expect(configurationSchema(declaration).safeParse({ mlock: 'yes' }).success).toBe(false);
  });

  it('takes a fingerprint for a model reference and rejects a path or a short digest', () => {
    const schema = configurationSchema(declaration);

    expect(schema.safeParse({ mmproj: FINGERPRINT }).success).toBe(true);
    expect(schema.safeParse({ mmproj: '/models/mmproj-F16.gguf' }).success).toBe(false);
    expect(schema.safeParse({ mmproj: 'a'.repeat(63) }).success).toBe(false);
    expect(schema.safeParse({ mmproj: FINGERPRINT.toUpperCase() }).success).toBe(false);
  });

  it('says what a model reference takes, so a form can read the reason', () => {
    const parsed = configurationSchema(declaration).safeParse({ mmproj: 'not-a-fingerprint' });

    expect(parsed.error?.issues[0].message).toBe("must be a catalogued file's fingerprint");
  });
});
