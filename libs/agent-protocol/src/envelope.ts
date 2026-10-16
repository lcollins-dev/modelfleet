import { z } from 'zod';

import { protocolVersionSchema } from './version';

/**
 * The frame one message type travels in. Declared fields alone survive a parse, so an agent a
 * release ahead can send a field this build has never heard of.
 */
export function envelopeSchema<TType extends string, TPayload>(type: TType, payloadSchema: z.ZodType<TPayload>) {
  return z.object({
    protocolVersion: protocolVersionSchema,
    messageId: z.uuid(),
    correlationId: z.uuid().optional(),
    type: z.literal(type),

    /** The sender's own clock, so it orders one sender's messages and nothing across two. */
    sentAt: z.iso.datetime({ offset: true }),

    payload: payloadSchema,
  });
}
