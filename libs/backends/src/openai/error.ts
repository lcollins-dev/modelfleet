import { z } from 'zod';

/** OpenAI's own types. A backend sending another is relayed with that type as written. */
export enum BackendErrorType {
  INVALID_REQUEST = 'invalid_request_error',
  AUTHENTICATION = 'authentication_error',
  PERMISSION = 'permission_error',
  NOT_FOUND = 'not_found_error',
  RATE_LIMIT = 'rate_limit_error',
  SERVER = 'server_error',
}

export const BackendErrorBody = z.looseObject({
  message: z.string(),
  type: z.string(),
  param: z.string().nullish(),
  code: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type BackendErrorBody = z.infer<typeof BackendErrorBody>;

export const BackendError = z.looseObject({ error: BackendErrorBody });
export type BackendError = z.infer<typeof BackendError>;

export function backendError(
  type: BackendErrorType,
  message: string,
  details: { param?: string; code?: string | number } = {}
): BackendError {
  return { error: { type, message, param: details.param ?? null, code: details.code ?? null } };
}

/** The type to name where a backend failed without an error body of its own, so the status is all there is. */
export function errorTypeForStatus(status: number): BackendErrorType {
  switch (status) {
    case 400:
      return BackendErrorType.INVALID_REQUEST;

    case 401:
      return BackendErrorType.AUTHENTICATION;

    case 403:
      return BackendErrorType.PERMISSION;

    case 404:
      return BackendErrorType.NOT_FOUND;

    case 429:
      return BackendErrorType.RATE_LIMIT;

    default:
      return BackendErrorType.SERVER;
  }
}
