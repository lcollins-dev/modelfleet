import { z } from 'zod';

import { timestamp } from '../../../fields';

export const ListApiKeyDto = z.object({
  id: z.number(),

  /** Safe to display: the public half of the credential. */
  keyId: z.string(),

  name: z.string(),

  ownerId: z.number(),

  ownerName: z.string().optional(),

  /** Stamped no more often than once a minute, so a busy key reads as recently used rather than exactly. */
  lastUsedDate: timestamp().nullable(),

  revokedDate: timestamp().nullable(),

  createdDate: timestamp(),
});
export type ListApiKeyDto = z.infer<typeof ListApiKeyDto>;
