import { z } from 'zod';

/** Set on every refusal the relay answers itself, carrying its code. A backend's own answer never carries it. */
export const RELAY_REFUSAL_HEADER = 'x-modelfleet-relay-refusal';

export enum RelayErrorCode {
  UNAUTHORIZED = 'unauthorized',
  NOT_FOUND = 'not_found',
  BAD_REQUEST = 'bad_request',
  INSTANCE_NOT_FOUND = 'instance_not_found',
  INSTANCE_NOT_READY = 'instance_not_ready',
  INSTANCE_UNREACHABLE = 'instance_unreachable',
}

export const RelayError = z.object({
  error: z.object({
    code: z.enum(RelayErrorCode),
    message: z.string(),
  }),
});
export type RelayError = z.infer<typeof RelayError>;

export function relayError(code: RelayErrorCode, message: string): RelayError {
  return { error: { code, message } };
}
