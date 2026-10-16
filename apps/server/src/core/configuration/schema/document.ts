import { z } from 'zod';

import { ConfigurationValue } from '@libs/dto';

const configurationValueSchema: z.ZodType<ConfigurationValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(configurationValueSchema),
    z.record(z.string(), configurationValueSchema),
  ])
);

/**
 * Holds every key to a value `jsonb` round-trips. The field schemas are loose, so this is the only check
 * a key neither of them models ever gets.
 */
export const configurationDocumentSchema = z.record(z.string(), configurationValueSchema, {
  error: 'must be a mapping of configuration keys',
});
