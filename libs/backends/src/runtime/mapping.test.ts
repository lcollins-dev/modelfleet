import { describe, expect, it } from 'vitest';

import { BackendErrorType } from '../openai';
import { backendErrorFrom } from './mapping';

describe('backendErrorFrom', () => {
  it('relays the backend error under its own type and message', () => {
    const body = { error: { code: 500, message: 'Failed to load model', type: 'server_error' } };

    expect(backendErrorFrom(500, body)).toMatchObject({
      error: { message: 'Failed to load model', type: 'server_error' },
    });
  });

  it('relays a type Modelfleet does not name', () => {
    const body = { error: { message: 'Slot unavailable', type: 'unavailable_error' } };

    expect(backendErrorFrom(503, body).error.type).toBe('unavailable_error');
  });

  it('names the type from the status where the backend answered without an error body', () => {
    expect(backendErrorFrom(400, 'Invalid request').error).toMatchObject({
      type: BackendErrorType.INVALID_REQUEST,
      message: 'Invalid request',
      code: 400,
    });
  });

  it('reads the message FastAPI nests under detail, as Kokoro-FastAPI answers', () => {
    const body = { detail: { error: 'invalid_model', message: 'Unsupported model: x', type: 'invalid_request_error' } };

    expect(backendErrorFrom(400, body).error).toMatchObject({
      type: BackendErrorType.INVALID_REQUEST,
      message: 'Unsupported model: x',
    });
    expect(backendErrorFrom(404, { detail: 'Not Found' }).error.message).toBe('Not Found');
  });

  it("reads the first of pydantic's validation failures, and whisper-server's bare error string", () => {
    const validation = {
      detail: [{ type: 'less_than_equal', loc: ['body', 'speed'], msg: 'Input should be at most 4' }],
    };

    expect(backendErrorFrom(422, validation).error.message).toBe('Input should be at most 4');
    expect(backendErrorFrom(400, { error: 'failed to read audio data' }).error.message).toBe(
      'failed to read audio data'
    );
  });

  it('falls back to a server error for a status it does not name', () => {
    expect(backendErrorFrom(502, undefined).error.type).toBe(BackendErrorType.SERVER);
  });

  it('never answers with the management error envelope', () => {
    const nest = { statusCode: 500, message: 'Internal server error', error: 'Internal Server Error' };
    const mapped = backendErrorFrom(500, nest);

    expect(mapped.error).toMatchObject({ type: BackendErrorType.SERVER, message: 'Internal server error' });
    expect(mapped).not.toHaveProperty('statusCode');
  });
});
