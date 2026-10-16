import { HttpStatus, Injectable } from '@nestjs/common';
import busboy from 'busboy';
import { Request, RequestHandler, Response, raw } from 'express';

import { BackendErrorType, backendError } from '@libs/backends/openai';

import { ConfigService } from '@/config/config.service';

import { OpenAiHttpException } from '../errors/openai-http.exception';

const MULTIPART_TYPE = 'multipart/form-data';

const MODEL_FIELD = 'model';
const FILE_FIELD = 'file';

const LIST_SUFFIX = '[]';

/** What body-parser names a body over its limit. */
const TOO_LARGE_TYPE = 'entity.too.large';

export interface IUpload {
  body: Buffer;

  /** Boundary included. */
  contentType: string;

  model: string;

  fields: ReadonlyMap<string, string>;
}

interface IForm {
  fields: Map<string, string>;

  /** The gateway reads a field's first value and FastAPI its last, so a repeat could route one and serve another. */
  repeated: Set<string>;

  /** busboy reads a part with no filename as a text field, whatever its bytes. */
  parts: Set<string>;
}

/** Call from a route's handler, never a middleware, so the key guard and both throttles run before a byte is read. */
@Injectable()
export class MultipartUploadService {
  private readonly limit: string;
  private readonly reader: RequestHandler;

  constructor(configService: ConfigService) {
    this.limit = configService.gatewayRequestMaxSizeAudio;
    this.reader = raw({ type: () => true, limit: this.limit });
  }

  async read(request: Request, response: Response): Promise<IUpload> {
    const contentType = request.headers['content-type'] ?? '';

    if (!contentType.toLowerCase().startsWith(MULTIPART_TYPE)) {
      throw this.invalid(HttpStatus.BAD_REQUEST, `The request body must be ${MULTIPART_TYPE}.`);
    }

    const body = await this.readBody(request, response);
    const form = await this.parseForm(body, contentType);
    const repeated = [...form.repeated].at(0);

    if (repeated !== undefined) {
      throw new OpenAiHttpException(
        HttpStatus.BAD_REQUEST,
        backendError(BackendErrorType.INVALID_REQUEST, `The form sends the '${repeated}' field more than once.`, {
          param: repeated,
        })
      );
    }

    const model = form.fields.get(MODEL_FIELD);

    if (model === undefined || model.length === 0) {
      throw this.missing(MODEL_FIELD);
    }

    if (!form.parts.has(FILE_FIELD)) {
      throw this.missing(FILE_FIELD);
    }

    return { body, contentType, model, fields: form.fields };
  }

  private async readBody(request: Request, response: Response): Promise<Buffer> {
    try {
      await new Promise<void>((resolve, reject) => {
        this.reader(request, response, (error?: unknown) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error instanceof Error ? error : this.unreadable());
          }
        });
      });
    } catch (error: unknown) {
      if (this.isTooLarge(error)) {
        throw this.invalid(HttpStatus.PAYLOAD_TOO_LARGE, `The upload is larger than the ${this.limit} limit.`);
      }

      throw error;
    }

    const body: unknown = request.body;

    return Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  }

  private parseForm(body: Buffer, contentType: string): Promise<IForm> {
    return new Promise<IForm>((resolve, reject) => {
      const form: IForm = { fields: new Map(), repeated: new Set(), parts: new Set() };
      let parser: busboy.Busboy;

      try {
        parser = busboy({ headers: { 'content-type': contentType } });
      } catch {
        reject(this.unreadable());

        return;
      }

      parser.on('field', (name, value) => {
        form.parts.add(name);

        if (!form.fields.has(name)) {
          form.fields.set(name, value);
        } else if (!name.endsWith(LIST_SUFFIX)) {
          form.repeated.add(name);
        }
      });

      parser.on('file', (name, file) => {
        form.parts.add(name);
        file.resume();
      });

      parser.on('error', () => reject(this.unreadable()));
      parser.on('close', () => resolve(form));

      parser.end(body);
    });
  }

  private isTooLarge(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'type' in error && error.type === TOO_LARGE_TYPE;
  }

  private missing(field: string): OpenAiHttpException {
    return new OpenAiHttpException(
      HttpStatus.BAD_REQUEST,
      backendError(BackendErrorType.INVALID_REQUEST, `The form is missing the '${field}' field.`, { param: field })
    );
  }

  private unreadable(): OpenAiHttpException {
    return this.invalid(HttpStatus.BAD_REQUEST, 'The multipart body could not be read.');
  }

  private invalid(status: HttpStatus, message: string): OpenAiHttpException {
    return new OpenAiHttpException(status, backendError(BackendErrorType.INVALID_REQUEST, message));
  }
}
