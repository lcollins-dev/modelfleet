import { z } from 'zod';

import { readJsonPath } from './json-path';

export enum ProbeMethod {
  GET = 'GET',
  POST = 'POST',
}

export const ReadinessProbe = z.strictObject({
  method: z.enum(ProbeMethod),
  path: z.string().regex(/^\//, { error: 'must start with /' }),

  /** Statuses worth reading a body from. Any other status leaves the instance starting. */
  passStatuses: z.array(z.number().int().min(100).max(599)).min(1),

  /** A value the body has to carry, for a backend that answers before it has finished loading. */
  body: z
    .strictObject({
      /** A dot path into the decoded JSON body, such as `status`. */
      path: z.string().min(1),

      equals: z.string(),
    })
    .optional(),
});

export const Readiness = z.strictObject({
  probe: ReadinessProbe,

  /** Replaces the agent's size-scaled launch timeout for this backend's instances. */
  startTimeoutSeconds: z.number().int().positive().optional(),
});

export type ReadinessProbe = z.infer<typeof ReadinessProbe>;

export type Readiness = z.infer<typeof Readiness>;

export interface IProbeResponse {
  status: number;

  /** `undefined` where the response carried no JSON body. */
  body: unknown;
}

export function readinessPasses(probe: ReadinessProbe, response: IProbeResponse): boolean {
  if (!probe.passStatuses.includes(response.status)) {
    return false;
  }

  if (probe.body === undefined) {
    return true;
  }

  return readJsonPath(response.body, probe.body.path) === probe.body.equals;
}
