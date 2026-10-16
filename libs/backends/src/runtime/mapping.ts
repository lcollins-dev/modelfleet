import {
  BackendError,
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  SpeechRequest,
  TranscriptionResponse,
  backendError,
  errorTypeForStatus,
} from '../openai';

const UNKNOWN_FAILURE = 'The backend failed without an error of its own.';

export interface IChatCompletionsMapping {
  request: (request: ChatCompletionRequest) => unknown;
  response: (body: unknown) => ChatCompletionResponse;
  chunk: (chunk: unknown) => ChatCompletionChunk;
}

export interface IEmbeddingsMapping {
  request: (request: EmbeddingRequest) => unknown;
  response: (body: unknown) => EmbeddingResponse;
}

export interface ITranscriptionMapping {
  response: (body: unknown) => TranscriptionResponse;
}

export interface ISpeechMapping {
  request: (request: SpeechRequest) => unknown;
}

export interface IBackendMapping {
  chatCompletions?: IChatCompletionsMapping;
  embeddings?: IEmbeddingsMapping;
  transcription?: ITranscriptionMapping;
  speech?: ISpeechMapping;

  error(status: number, body: unknown): BackendError;
}

export function backendErrorFrom(status: number, body: unknown): BackendError {
  const parsed = BackendError.safeParse(body);

  if (parsed.success) {
    return parsed.data;
  }

  return backendError(errorTypeForStatus(status), messageFrom(body) ?? UNKNOWN_FAILURE, { code: status });
}

function messageFrom(body: unknown): string | undefined {
  if (typeof body === 'string' && body.length > 0) {
    return body;
  }

  if (typeof body !== 'object' || body === null) {
    return undefined;
  }

  if ('message' in body && typeof body.message === 'string') {
    return body.message;
  }

  // whisper-server answers `{ error: "..." }`, and a pydantic validation failure carries `msg`.
  if ('error' in body && typeof body.error === 'string') {
    return messageFrom(body.error);
  }

  if ('msg' in body && typeof body.msg === 'string') {
    return body.msg;
  }

  // FastAPI nests its failure under `detail`: a string, an object of the server's own, or a list of them.
  if (!('detail' in body)) {
    return undefined;
  }

  return messageFrom(Array.isArray(body.detail) ? body.detail.at(0) : body.detail);
}
