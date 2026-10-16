import {
  CHAT_COMPLETION_CHUNK_OBJECT,
  CHAT_COMPLETION_OBJECT,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EMBEDDING_LIST_OBJECT,
  EMBEDDING_OBJECT,
  EmbeddingRequest,
  EmbeddingResponse,
  TranscriptionResponse,
} from '../../openai';
import { IChatCompletionsMapping, IEmbeddingsMapping, ITranscriptionMapping } from '../../runtime/mapping';

const ASR_TEXT_TAG = '<asr_text>';

export const llamaCppChatCompletions: IChatCompletionsMapping = {
  request: chatCompletionRequest,
  response: chatCompletionResponse,
  chunk: chatCompletionChunk,
};

export const llamaCppEmbeddings: IEmbeddingsMapping = { request: embeddingRequest, response: embeddingResponse };

export const llamaCppTranscription: ITranscriptionMapping = { response: transcriptionResponse };

/** llama.cpp reads `max_tokens` alone, so a request naming only OpenAI's replacement would be served unbounded. */
function chatCompletionRequest(request: ChatCompletionRequest): unknown {
  const limit = request.max_completion_tokens;

  if (request.max_tokens !== undefined && request.max_tokens !== null) {
    return request;
  }

  return limit === undefined || limit === null ? request : { ...request, max_tokens: limit };
}

function chatCompletionResponse(body: unknown): ChatCompletionResponse {
  return ChatCompletionResponse.parse(withObject(body, CHAT_COMPLETION_OBJECT));
}

function chatCompletionChunk(chunk: unknown): ChatCompletionChunk {
  return ChatCompletionChunk.parse(withObject(chunk, CHAT_COMPLETION_CHUNK_OBJECT));
}

function embeddingRequest(request: EmbeddingRequest): unknown {
  return request;
}

function embeddingResponse(body: unknown): EmbeddingResponse {
  const listed = withObject(body, EMBEDDING_LIST_OBJECT);

  if (!isRecord(listed) || !Array.isArray(listed.data)) {
    return EmbeddingResponse.parse(listed);
  }

  const data = listed.data.map(entry => withObject(entry, EMBEDDING_OBJECT));

  return EmbeddingResponse.parse({ ...listed, data });
}

/** Keeps the text after the first tag, since llama-server relays Qwen3-ASR's raw tagged output (llama.cpp #26749). */
function transcriptionResponse(body: unknown): TranscriptionResponse {
  const parsed = TranscriptionResponse.parse(body);
  const tagAt = parsed.text.indexOf(ASR_TEXT_TAG);

  return tagAt === -1 ? parsed : { ...parsed, text: parsed.text.slice(tagAt + ASR_TEXT_TAG.length) };
}

/** llama.cpp omits `object` on some responses, and it is a constant rather than anything the backend decides. */
function withObject(body: unknown, object: string): unknown {
  if (!isRecord(body) || typeof body.object === 'string') {
    return body;
  }

  return { ...body, object };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
