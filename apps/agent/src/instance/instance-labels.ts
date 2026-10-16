import { z } from 'zod';

import { BackendId, ReadinessProbe, ProbeMethod } from '@libs/backends';
import { BACKEND_LABEL, INSTANCE_LABEL } from '@libs/backends/runtime';

export const REVISION_LABEL = 'modelfleet.revision';
export const PROBE_LABEL = 'modelfleet.probe';
export const START_TIMEOUT_LABEL = 'modelfleet.start-timeout-ms';
export const PORT_LABEL = 'modelfleet.port';

/** What a container is read back as: the revision comes from its own label, not from here. */
export interface IContainerSupervision {
  probe: ReadinessProbe;
  startTimeoutMs: number;

  /** The port inside the container. Nothing is published on the host, so this is the port that is addressed. */
  port: number;
}

export interface IContainerAdoption extends IContainerSupervision {
  revision: number;
}

const instanceKeySchema = z.uuid();

/** Looser than a definition's own probe schema, so a label another agent version wrote still adopts. */
const probeSchema = z.object({
  method: z.enum(ProbeMethod),
  path: z.string().regex(/^\//),
  passStatuses: z.array(z.number().int()),
  body: z.object({ path: z.string().min(1), equals: z.string() }).optional(),
});

export function adoptionLabels(adoption: IContainerAdoption): Record<string, string> {
  return {
    [REVISION_LABEL]: String(adoption.revision),
    [PROBE_LABEL]: JSON.stringify(adoption.probe),
    [START_TIMEOUT_LABEL]: String(adoption.startTimeoutMs),
    [PORT_LABEL]: String(adoption.port),
  };
}

/** Null unless the label carries a uuid, which is all observed state can report and so all this agent may adopt. */
export function readInstanceKey(labels: Record<string, string>): string | null {
  const instanceKey = labels[INSTANCE_LABEL] ?? '';

  return instanceKeySchema.safeParse(instanceKey).success ? instanceKey : null;
}

/** Null where the label names a backend this agent does not know. */
export function readBackend(labels: Record<string, string>): BackendId | null {
  const named = labels[BACKEND_LABEL];

  return Object.values(BackendId).find(backend => backend === named) ?? null;
}

export function readRevision(labels: Record<string, string>): number {
  const revision = Number.parseInt(labels[REVISION_LABEL] ?? '', 10);

  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

/** Null where a container carries the instance label without the rest, which nothing this agent created does. */
export function readAdoption(labels: Record<string, string>): IContainerSupervision | null {
  const probe = probeSchema.safeParse(readJson(labels[PROBE_LABEL] ?? ''));
  const startTimeoutMs = Number.parseInt(labels[START_TIMEOUT_LABEL] ?? '', 10);
  const port = Number.parseInt(labels[PORT_LABEL] ?? '', 10);

  if (!probe.success || !Number.isInteger(startTimeoutMs) || startTimeoutMs <= 0) {
    return null;
  }

  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  return { probe: probe.data, startTimeoutMs, port };
}

function readJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
