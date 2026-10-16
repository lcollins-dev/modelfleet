import { stdSerializers } from 'pino';

// An axios error carries the request, Authorization header included, under config, request and response; a router
// navigation failure carries routes under to and from, whose full path can hold an invite or reset token.
const UNSAFE_ERROR_KEYS = new Set(['config', 'request', 'response', 'to', 'from']);

// A plain object, so pino's hidden reference to the raw error does not reach the console either.
export const serializeError = (error: unknown): unknown => {
  if (!(error instanceof Error)) {
    return error;
  }

  const serialized = stdSerializers.err(error);
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(serialized)) {
    if (!UNSAFE_ERROR_KEYS.has(key)) {
      safe[key] = value;
    }
  }

  return safe;
};
