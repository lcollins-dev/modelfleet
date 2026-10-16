import { describe, expect, it } from 'vitest';

import { EmbeddingRequest, EmbeddingResponse } from './embedding';

describe('EmbeddingRequest', () => {
  it('parses one text', () => {
    expect(EmbeddingRequest.parse({ model: 'bge-m3', input: 'Hello' })).toEqual({
      model: 'bge-m3',
      input: 'Hello',
    });
  });

  it('parses a batch of texts', () => {
    const request = { model: 'bge-m3', input: ['Hello', 'World'] };

    expect(EmbeddingRequest.parse(request)).toEqual(request);
  });

  it('parses input already tokenised', () => {
    const request = { model: 'bge-m3', input: [[1, 2, 3]] };

    expect(EmbeddingRequest.parse(request)).toEqual(request);
  });

  it('carries a parameter it does not model through untouched', () => {
    const parsed = EmbeddingRequest.parse({ model: 'bge-m3', input: 'Hello', truncate: true });

    expect(parsed).toMatchObject({ truncate: true });
  });

  it('rejects a request naming no model', () => {
    expect(EmbeddingRequest.safeParse({ input: 'Hello' }).success).toBe(false);
  });
});

describe('EmbeddingResponse', () => {
  it('parses a float embedding with its usage', () => {
    const response = {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, -0.2] }],
      model: 'bge-m3',
      usage: { prompt_tokens: 4, total_tokens: 4 },
    };

    expect(EmbeddingResponse.parse(response)).toEqual(response);
  });

  it('parses a base64 embedding', () => {
    const response = {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: 'zczMPQ==' }],
      model: 'bge-m3',
    };

    expect(EmbeddingResponse.parse(response)).toEqual(response);
  });
});
