import { describe, expect, it } from 'vitest';

import { ChatCompletionRequest, EmbeddingRequest } from '../../openai';
import { llamaCppChatCompletions, llamaCppEmbeddings, llamaCppTranscription } from './mapping';

const request: ChatCompletionRequest = {
  model: 'chat-8b',
  messages: [{ role: 'user', content: 'Hello' }],
};

const response = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1_772_000_000,
  model: 'chat-8b',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
};

const chunk = {
  id: 'chatcmpl-1',
  object: 'chat.completion.chunk',
  created: 1_772_000_000,
  model: 'chat-8b',
  choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
};

const chatMapping = llamaCppChatCompletions;
const embeddingMapping = llamaCppEmbeddings;
const transcriptionMapping = llamaCppTranscription;

const embeddings: EmbeddingRequest = { model: 'embed-small', input: 'Hello' };

describe('chatCompletionRequest', () => {
  it('carries a parameter Modelfleet does not model through to the backend', () => {
    const extended = { ...request, mirostat: 2, mirostat_tau: 5 };

    expect(chatMapping.request(extended)).toMatchObject({ mirostat: 2, mirostat_tau: 5 });
  });

  it('names the token limit under the key llama.cpp reads', () => {
    const mapped = chatMapping.request({ ...request, max_completion_tokens: 256 });

    expect(mapped).toMatchObject({ max_tokens: 256, max_completion_tokens: 256 });
  });

  it('leaves a limit the caller already named alone', () => {
    const mapped = chatMapping.request({ ...request, max_tokens: 64, max_completion_tokens: 256 });

    expect(mapped).toMatchObject({ max_tokens: 64 });
  });

  it('adds no limit where the caller named none', () => {
    expect(chatMapping.request(request)).toEqual(request);
  });
});

describe('chatCompletionResponse', () => {
  it('normalises the backend response onto the canonical shape', () => {
    expect(chatMapping.response(response)).toEqual(response);
  });

  it('carries a field with no OpenAI equivalent back to the caller', () => {
    const timings = { predicted_per_second: 41.2 };

    expect(chatMapping.response({ ...response, timings })).toMatchObject({ timings });
  });

  it('names the object where the backend left it out', () => {
    const { object, ...withoutObject } = response;

    expect(chatMapping.response(withoutObject).object).toBe(object);
  });

  it('rejects a body that is not a completion at all', () => {
    expect(() => chatMapping.response({ content: 'Hi' })).toThrow();
  });
});

describe('chatCompletionChunk', () => {
  it('normalises one chunk on its own, with no complete response to hand', () => {
    expect(chatMapping.chunk(chunk)).toEqual(chunk);
  });

  it('normalises a chunk carrying usage on the final delta', () => {
    const usage = { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 };
    const final = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage };

    expect(chatMapping.chunk(final)).toEqual(final);
  });

  it('names the chunk object where the backend left it out', () => {
    const { object, ...withoutObject } = chunk;

    expect(chatMapping.chunk(withoutObject).object).toBe(object);
  });
});

describe('embeddingRequest', () => {
  it('carries a parameter Modelfleet does not model through to the backend', () => {
    expect(embeddingMapping.request({ ...embeddings, truncate: false })).toMatchObject({ truncate: false });
  });
});

describe('embeddingResponse', () => {
  it('normalises the backend response onto the canonical shape', () => {
    const body = {
      object: 'list',
      model: 'embed-small',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    };

    expect(embeddingMapping.response(body)).toEqual(body);
  });

  it('names the list and its entries where the backend left them out', () => {
    const body = { model: 'embed-small', data: [{ index: 0, embedding: [0.1, 0.2] }] };
    const mapped = embeddingMapping.response(body);

    expect(mapped.object).toBe('list');
    expect(mapped.data[0].object).toBe('embedding');
  });
});

describe('transcriptionResponse', () => {
  const answer = {
    type: 'transcript.text.done',
    text: 'language English<asr_text>And so, my fellow Americans.',
    usage: { type: 'tokens', input_tokens: 171, output_tokens: 30, total_tokens: 201 },
  };

  it("drops Qwen3-ASR's language header, keeping the transcript and everything beside it", () => {
    expect(transcriptionMapping.response(answer)).toEqual({ ...answer, text: 'And so, my fellow Americans.' });
  });

  it('keeps a tag inside the transcript itself, splitting on the first alone', () => {
    const nested = { text: 'language English<asr_text>say <asr_text> aloud' };

    expect(transcriptionMapping.response(nested).text).toBe('say <asr_text> aloud');
  });

  it('answers empty for audio Qwen3-ASR heard nothing in', () => {
    expect(transcriptionMapping.response({ text: 'language None<asr_text>' }).text).toBe('');
  });

  it('passes a transcript with no header as written', () => {
    expect(transcriptionMapping.response({ text: 'And so, my fellow Americans.' })).toEqual({
      text: 'And so, my fellow Americans.',
    });
  });

  it('rejects a body that is not a transcription at all', () => {
    expect(() => transcriptionMapping.response({ content: 'hi' })).toThrow();
  });
});
