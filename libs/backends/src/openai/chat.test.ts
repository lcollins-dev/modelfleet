import { describe, expect, it } from 'vitest';

import { ChatRole, ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse } from './chat';

const request = {
  model: 'llama-3-8b',
  messages: [{ role: ChatRole.USER, content: 'Hello' }],
};

describe('ChatCompletionRequest', () => {
  it('parses the smallest request a caller can send', () => {
    expect(ChatCompletionRequest.parse(request)).toEqual(request);
  });

  it('carries a sampling parameter it does not model through untouched', () => {
    const parsed = ChatCompletionRequest.parse({ ...request, mirostat: 2, dry_multiplier: 0.8 });

    expect(parsed).toMatchObject({ mirostat: 2, dry_multiplier: 0.8 });
  });

  it('keeps content parts as written', () => {
    const messages = [
      {
        role: ChatRole.USER,
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
        ],
      },
    ];

    expect(ChatCompletionRequest.parse({ ...request, messages })).toEqual({ ...request, messages });
  });

  it('accepts a role OpenAI does not define, leaving the refusal to the backend', () => {
    expect(ChatCompletionRequest.safeParse({ ...request, messages: [{ role: 'wizard' }] }).success).toBe(true);
  });

  it('accepts a temperature outside the range OpenAI documents', () => {
    expect(ChatCompletionRequest.safeParse({ ...request, temperature: 5 }).success).toBe(true);
  });

  it('rejects a request naming no model', () => {
    expect(ChatCompletionRequest.safeParse({ messages: request.messages }).success).toBe(false);
  });

  it('rejects a request carrying no message', () => {
    expect(ChatCompletionRequest.safeParse({ ...request, messages: [] }).success).toBe(false);
  });
});

describe('ChatCompletionResponse', () => {
  it('parses a completion with its usage', () => {
    const response = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1_756_000_000,
      model: 'llama-3-8b',
      choices: [{ index: 0, message: { role: ChatRole.ASSISTANT, content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
    };

    expect(ChatCompletionResponse.parse(response)).toEqual(response);
  });

  it('keeps a backend field with no OpenAI equivalent', () => {
    const response = {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1_756_000_000,
      model: 'llama-3-8b',
      choices: [{ index: 0, message: { role: ChatRole.ASSISTANT, content: 'Hi' }, finish_reason: 'stop' }],
      timings: { prompt_ms: 41.2, predicted_per_second: 88.4 },
    };

    expect(ChatCompletionResponse.parse(response)).toMatchObject({ timings: response.timings });
  });
});

describe('ChatCompletionChunk', () => {
  it('parses a delta chunk on its own', () => {
    const chunk = {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1_756_000_000,
      model: 'llama-3-8b',
      choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: null }],
    };

    expect(ChatCompletionChunk.parse(chunk)).toEqual(chunk);
  });

  it('parses a final chunk carrying usage', () => {
    const chunk = {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1_756_000_000,
      model: 'llama-3-8b',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
    };

    expect(ChatCompletionChunk.parse(chunk)).toEqual(chunk);
  });

  it('parses a tool call assembled across deltas', () => {
    const chunk = {
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1_756_000_000,
      model: 'llama-3-8b',
      choices: [
        { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city"' } }] }, finish_reason: null },
      ],
    };

    expect(ChatCompletionChunk.parse(chunk)).toEqual(chunk);
  });
});
