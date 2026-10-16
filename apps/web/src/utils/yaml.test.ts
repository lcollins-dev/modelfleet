import { describe, expect, it } from 'vitest';

import { applyToDocument, readDocument } from './yaml';

describe('applyToDocument', () => {
  it('keeps the comments and key order around an edited key', () => {
    const document = '# Tuned for a single 4090\nimage: llama:latest\n\nthreads: 16\n';

    expect(applyToDocument(document, { threads: 8 })).toBe(
      '# Tuned for a single 4090\nimage: llama:latest\n\nthreads: 8\n'
    );
  });

  it('keeps a key the edits do not name', () => {
    expect(applyToDocument('placement:\n  spreadAcrossNodes: true\n', { threads: 8 })).toBe(
      'placement:\n  spreadAcrossNodes: true\nthreads: 8\n'
    );
  });

  it('replaces a document that is not a mapping', () => {
    expect(applyToDocument('just a string\n', { threads: 8 })).toBe('threads: 8\n');
  });

  it('removes a key mapped to undefined', () => {
    expect(applyToDocument('image: llama:latest\nthreads: 16\n', { threads: undefined })).toBe('image: llama:latest\n');
  });

  it('builds a document from nothing', () => {
    expect(applyToDocument('', { image: 'llama:latest' })).toBe('image: llama:latest\n');
  });

  it('writes a list as a block sequence', () => {
    expect(applyToDocument('', { extraFlags: ['--mlock', '--no-mmap'] })).toBe(
      'extraFlags:\n  - --mlock\n  - --no-mmap\n'
    );
  });
});

describe('readDocument', () => {
  it('reads a mapping into a configuration document', () => {
    expect(readDocument('image: llama:latest\nthreads: 16\n')).toEqual({ image: 'llama:latest', threads: 16 });
  });

  it('reads a document holding nothing as an empty mapping', () => {
    expect(readDocument('# nothing but a comment\n')).toEqual({});
  });

  it('reads nested mappings and lists', () => {
    expect(readDocument('placement:\n  gpus:\n    - nodeId: 1\n      deviceKey: GPU-1\n')).toEqual({
      placement: { gpus: [{ nodeId: 1, deviceKey: 'GPU-1' }] },
    });
  });

  it('answers null for a document that is not a mapping', () => {
    expect(readDocument('just a string\n')).toBeNull();
  });

  it('answers null for a document that does not parse', () => {
    expect(readDocument('image: [unclosed\n')).toBeNull();
  });
});
