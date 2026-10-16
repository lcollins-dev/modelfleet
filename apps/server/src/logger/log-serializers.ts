import { omit } from 'lodash';
import { IncomingMessage } from 'node:http';
import { stdSerializers } from 'pino-http';

interface ISerializedError {
  type: string;
  message: string;
  stack: string;
  code?: unknown;
}

const isSerializedError = (value: unknown): value is ISerializedError =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string' &&
  'message' in value &&
  typeof value.message === 'string' &&
  'stack' in value &&
  typeof value.stack === 'string';

/** Keeps only the type, message, stack and code, since other properties can hold query parameters or request bodies. */
export function serializeError(value: unknown): unknown {
  const serialized: unknown = value instanceof Error ? stdSerializers.err(value) : value;

  if (!isSerializedError(serialized)) {
    return value;
  }

  const { type, message, stack, code } = serialized;

  return typeof code === 'string' || typeof code === 'number'
    ? { type, message, stack, code }
    : { type, message, stack };
}

export function serializeReceivedRequest(req: IncomingMessage): Record<string, unknown> {
  return omit(stdSerializers.req(req), 'params');
}
