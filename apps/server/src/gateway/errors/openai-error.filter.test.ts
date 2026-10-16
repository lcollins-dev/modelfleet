import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendError, BackendErrorType, backendError } from '@libs/backends/openai';

import { OpenAiErrorFilter } from './openai-error.filter';
import { OpenAiHttpException } from './openai-http.exception';

describe('OpenAiErrorFilter', () => {
  let json: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof vi.fn>;
  let host: ArgumentsHost;
  let filter: OpenAiErrorFilter;

  const caught = (): { status: number; body: BackendError } => ({
    status: status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as BackendError,
  });

  beforeEach(() => {
    json = vi.fn();
    status = vi.fn(() => ({ json }));

    host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    filter = new OpenAiErrorFilter();
  });

  it('passes a route that named its own type and code straight through', () => {
    const body = backendError(BackendErrorType.AUTHENTICATION, 'Bad key', { code: 'invalid_api_key' });

    filter.catch(new OpenAiHttpException(HttpStatus.UNAUTHORIZED, body), host);

    expect(caught()).toEqual({ status: 401, body });
  });

  it('shapes an ordinary Nest exception into OpenAI form rather than the management API shape', () => {
    filter.catch(new NotFoundException('That model does not exist'), host);

    const { status: code, body } = caught();

    expect(code).toBe(404);
    expect(body.error).toEqual({
      message: 'That model does not exist',
      type: BackendErrorType.NOT_FOUND,
      param: null,
      code: null,
    });
    expect(body).not.toHaveProperty('statusCode');
  });

  it('joins the array a validation failure carries', () => {
    filter.catch(new BadRequestException(['name must be a string', 'name should not be empty']), host);

    expect(caught().body.error.message).toBe('name must be a string, name should not be empty');
  });

  it('names the type the status maps to', () => {
    filter.catch(new UnauthorizedException('Nope'), host);
    expect(caught().body.error.type).toBe(BackendErrorType.AUTHENTICATION);

    json.mockClear();
    status.mockClear();

    filter.catch(new BadRequestException('Nope'), host);
    expect(caught().body.error.type).toBe(BackendErrorType.INVALID_REQUEST);
  });

  it('answers a thrown non-exception as an api error without leaking its message', () => {
    filter.catch(new Error('connection string postgres://user:pw@host'), host);

    const { status: code, body } = caught();

    expect(code).toBe(500);
    expect(body.error.type).toBe(BackendErrorType.SERVER);
    expect(body.error.message).not.toContain('postgres');
  });

  it('does not leak the message of a server-side Nest exception either', () => {
    filter.catch(new InternalServerErrorException('table "api_key" does not exist'), host);

    const { status: code, body } = caught();

    expect(code).toBe(500);
    expect(body.error.type).toBe(BackendErrorType.SERVER);
    expect(body.error.message).not.toContain('api_key');
  });

  it.each([
    [413, 'request entity too large', BackendErrorType.INVALID_REQUEST],
    [400, 'Unexpected token } in JSON', BackendErrorType.INVALID_REQUEST],
  ])('answers a body the parser refused with %i and its own message', (code, message, type) => {
    filter.catch({ status: code, message, expose: true, type: 'entity.too.large' }, host);

    expect(caught().status).toBe(code);
    expect(caught().body.error).toMatchObject({ type, message });
  });

  it('keeps an unexposed error the server did not mean to show behind a 500', () => {
    filter.catch({ status: 413, message: 'internal detail', expose: false }, host);

    expect(caught().status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(caught().body.error.message).not.toContain('internal detail');
  });

  it('ends a stream whose head has gone with the error as an event, since its status is spent', () => {
    const end = vi.fn();

    filter.catch(new OpenAiHttpException(503, backendError(BackendErrorType.SERVER, 'Down.')), {
      switchToHttp: () => ({ getResponse: () => ({ headersSent: true, writableEnded: false, status, end }) }),
    } as unknown as ArgumentsHost);

    const event = end.mock.calls[0][0] as string;

    expect(status).not.toHaveBeenCalled();
    expect(event.endsWith('\n\n')).toBe(true);
    expect(JSON.parse(event.slice('data: '.length))).toEqual(backendError(BackendErrorType.SERVER, 'Down.'));
  });

  it('writes nothing to a stream that has already ended', () => {
    const end = vi.fn();

    filter.catch(new OpenAiHttpException(503, backendError(BackendErrorType.SERVER, 'Down.')), {
      switchToHttp: () => ({ getResponse: () => ({ headersSent: true, writableEnded: true, status, end }) }),
    } as unknown as ArgumentsHost);

    expect(end).not.toHaveBeenCalled();
  });
});
