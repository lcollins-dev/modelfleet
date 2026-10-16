import ms, { type StringValue } from 'ms';
import { z } from 'zod';

import { ConfigurationDocument } from '@libs/dto';
import { durationValue } from '@libs/runtime';

export const DECLARED_VRAM_KEY = 'vramGib';

/** Reserved against a backend field name; a document holds these beside the backend's own keys. */
export const FLEET_FIELDS = ['replicas', 'placement', 'idleTimeout', DECLARED_VRAM_KEY];

/** Every key a document holds beyond these marks a deployment out of date when it changes. */
export const HOT_FIELDS = ['replicas', 'idleTimeout', DECLARED_VRAM_KEY];

const MAX_REPLICAS = 1024;

const MAX_DECLARED_VRAM_GIB = 4096;

/** Matches `LAST_USED_STAMP_INTERVAL_MS`: a shorter timeout would read a deployment called every request as idle. */
const MIN_IDLE_TIMEOUT: StringValue = '1m';

export type IFleetPlacement = z.infer<typeof placementSchema>;

export const placementSchema = z.strictObject({
  nodeIds: z.array(z.int({ error: 'must be a node id' }).min(1)).optional(),
  gpus: z
    .array(
      z.strictObject({
        nodeId: z.int({ error: 'must be a node id' }).min(1),
        deviceKey: z.string({ error: 'must be a device key' }).min(1).max(128),
      })
    )
    .optional(),
  spreadAcrossNodes: z.boolean({ error: 'must be true or false' }).optional(),
});

export interface IDocumentHalves {
  fleet: ConfigurationDocument;
  backend: ConfigurationDocument;
}

/** Loose, so a key the backend declares passes through untouched for the backend's own schema to validate. */
export function fleetSchema(): z.ZodType {
  return z.looseObject({
    replicas: z.int({ error: 'must be a whole number' }).min(1).max(MAX_REPLICAS).optional(),
    placement: placementSchema.nullish(),
    idleTimeout: durationValue()
      .refine(value => ms(value) >= ms(MIN_IDLE_TIMEOUT), {
        error: `must be ${MIN_IDLE_TIMEOUT} or longer, since a deployment's last use is stamped no more often`,
      })
      .optional(),
    [DECLARED_VRAM_KEY]: z
      .number({ error: 'must be a number of GiB' })
      .positive({ error: 'must be more than 0' })
      .max(MAX_DECLARED_VRAM_GIB)
      .optional(),
  });
}

export function splitByOwner(document: ConfigurationDocument): IDocumentHalves {
  const halves: IDocumentHalves = { fleet: {}, backend: {} };

  for (const [key, value] of Object.entries(document)) {
    if (FLEET_FIELDS.includes(key)) {
      halves.fleet[key] = value;
    } else {
      halves.backend[key] = value;
    }
  }

  return halves;
}
