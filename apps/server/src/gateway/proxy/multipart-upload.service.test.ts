import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';

import { BackendError } from '@libs/backends/openai';

import { MultipartUploadService } from './multipart-upload.service';
import { ConfigService } from '@/config/config.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

const BOUNDARY = 'modelfleet-test-boundary';
const MULTIPART_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

interface IPart {
  name: string;
  value: string | Buffer;
  filename?: string;
}

const formOf = (parts: IPart[]): Buffer =>
  Buffer.concat([
    ...parts.flatMap(part => [
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"` +
          (part.filename === undefined ? '' : `; filename="${part.filename}"\r\nContent-Type: audio/wav`) +
          '\r\n\r\n'
      ),
      Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value),
      Buffer.from('\r\n'),
    ]),
    Buffer.from(`--${BOUNDARY}--\r\n`),
  ]);

const AUDIO = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x0d, 0x0a]);

const requestOf = (body: Buffer, contentType = MULTIPART_TYPE, length = body.length): Request =>
  Object.assign(Readable.from([body]), {
    headers: { 'content-type': contentType, 'content-length': String(length) },
  }) as unknown as Request;

const refusalFrom = async (run: () => Promise<unknown>): Promise<OpenAiHttpException> => {
  try {
    await run();
  } catch (error: unknown) {
    return error as OpenAiHttpException;
  }

  throw new Error('The upload was expected to be refused');
};

const bodyOf = (error: OpenAiHttpException): BackendError => error.getResponse() as BackendError;

describe('MultipartUploadService', () => {
  let multipartUploadService: MultipartUploadService;

  beforeEach(() => {
    multipartUploadService = new MultipartUploadService({ gatewayRequestMaxSizeAudio: '1kb' } as ConfigService);
  });

  it('reads model from a form that sends the file first, and keeps the bytes as they arrived', async () => {
    const body = formOf([
      { name: 'file', value: AUDIO, filename: 'clip.wav' },
      { name: 'model', value: 'asr-2b' },
      { name: 'response_format', value: 'json' },
    ]);

    const upload = await multipartUploadService.read(requestOf(body), {} as Response);

    expect(upload.model).toBe('asr-2b');
    expect(upload.fields.get('response_format')).toBe('json');
    expect(upload.body.equals(body)).toBe(true);
    expect(upload.contentType).toBe(MULTIPART_TYPE);
  });

  it('refuses an upload over the limit as a 413 naming it, on its Content-Length alone', async () => {
    const thrown = await refusalFrom(() =>
      multipartUploadService.read(requestOf(Buffer.alloc(0), MULTIPART_TYPE, 2048), {} as Response)
    );

    expect(thrown.getStatus()).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(bodyOf(thrown).error).toMatchObject({
      type: 'invalid_request_error',
      message: 'The upload is larger than the 1kb limit.',
    });
  });

  it('refuses a body that is not multipart', async () => {
    const thrown = await refusalFrom(() =>
      multipartUploadService.read(requestOf(Buffer.from('{}'), 'application/json'), {} as Response)
    );

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error.message).toBe('The request body must be multipart/form-data.');
  });

  it.each([
    ['model', [{ name: 'file', value: AUDIO, filename: 'clip.wav' }]],
    ['file', [{ name: 'model', value: 'asr-2b' }]],
  ])('refuses a form without %s, naming it', async (missing, parts) => {
    const thrown = await refusalFrom(() => multipartUploadService.read(requestOf(formOf(parts)), {} as Response));

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error).toMatchObject({ param: missing, type: 'invalid_request_error' });
  });

  it('refuses a form sending a field twice, which a backend could read differently, naming it', async () => {
    const body = formOf([
      { name: 'model', value: 'asr-2b' },
      { name: 'file', value: AUDIO, filename: 'clip.wav' },
      { name: 'stream', value: 'false' },
      { name: 'stream', value: 'true' },
    ]);

    const thrown = await refusalFrom(() => multipartUploadService.read(requestOf(body), {} as Response));

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(bodyOf(thrown).error).toMatchObject({ param: 'stream', type: 'invalid_request_error' });
  });

  it('reads a list field sent once per value', async () => {
    const body = formOf([
      { name: 'model', value: 'asr-2b' },
      { name: 'file', value: AUDIO, filename: 'clip.wav' },
      { name: 'timestamp_granularities[]', value: 'word' },
      { name: 'timestamp_granularities[]', value: 'segment' },
    ]);

    const upload = await multipartUploadService.read(requestOf(body), {} as Response);

    expect(upload.model).toBe('asr-2b');
  });

  it('refuses a form cut off before its closing boundary', async () => {
    const body = formOf([{ name: 'model', value: 'asr-2b' }]).subarray(0, 40);

    const thrown = await refusalFrom(() => multipartUploadService.read(requestOf(body), {} as Response));

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('refuses a multipart type that names no boundary', async () => {
    const thrown = await refusalFrom(() =>
      multipartUploadService.read(requestOf(Buffer.from('x'), 'multipart/form-data'), {} as Response)
    );

    expect(thrown.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });
});
