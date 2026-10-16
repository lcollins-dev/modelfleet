import { z } from 'zod';

import { GpuVendor, ProcessAttribution, TelemetryErrorScope } from '@libs/agent-protocol';

/** Raised in step with `version` in `crates/mf-gpu/snapshot.contract.json`. */
export const GPU_SNAPSHOT_SCHEMA_VERSION = 1;

const snapshotProcessSchema = z.object({
  pid: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative().optional(),
  name: z.string().min(1).optional(),
});
export type SnapshotProcess = z.infer<typeof snapshotProcessSchema>;

const snapshotDeviceSchema = z.object({
  uuid: z.string().min(1).optional(),
  pciBusId: z.string().min(1).optional(),
  index: z.number().int().nonnegative(),
  vendor: z.enum(GpuVendor),
  name: z.string().min(1).optional(),
  memoryTotalBytes: z.number().int().nonnegative().optional(),
  memoryUsedBytes: z.number().int().nonnegative().optional(),
  utilisationPercent: z.number().int().min(0).max(100).optional(),
  temperatureC: z.number().int().optional(),
  powerDrawWatts: z.number().int().nonnegative().optional(),
  processAttribution: z.enum(ProcessAttribution),
  processes: z.array(snapshotProcessSchema),
});
export type SnapshotDevice = z.infer<typeof snapshotDeviceSchema>;

const snapshotErrorSchema = z.object({
  scope: z.enum(TelemetryErrorScope),
  vendor: z.enum(GpuVendor),
  device: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
  message: z.string().min(1),
});

export const gpuSnapshotSchema = z.object({
  schema: z.literal(GPU_SNAPSHOT_SCHEMA_VERSION),
  capturedAt: z.iso.datetime({ offset: true }),
  devices: z.array(snapshotDeviceSchema),
  errors: z.array(snapshotErrorSchema),
});
export type GpuSnapshot = z.infer<typeof gpuSnapshotSchema>;

const versionedSchema = z.object({ schema: z.number().int() });

export interface ISnapshotAccepted {
  ok: true;
  snapshot: GpuSnapshot;
}

export interface ISnapshotRefused {
  ok: false;
  reason: string;
}

export type SnapshotResult = ISnapshotAccepted | ISnapshotRefused;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => (issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

export function deviceKeyOf(device: Pick<SnapshotDevice, 'uuid'>): string | null {
  return device.uuid ?? null;
}

export function parseGpuSnapshot(line: string): SnapshotResult {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'The line is not valid JSON' };
  }

  const versioned = versionedSchema.safeParse(parsed);

  if (!versioned.success) {
    return { ok: false, reason: 'The line carries no snapshot schema version' };
  }

  if (versioned.data.schema !== GPU_SNAPSHOT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `Snapshot schema ${versioned.data.schema} is newer than the ${GPU_SNAPSHOT_SCHEMA_VERSION} this agent reads`,
    };
  }

  const result = gpuSnapshotSchema.safeParse(parsed);

  if (!result.success) {
    return { ok: false, reason: formatIssues(result.error) };
  }

  return { ok: true, snapshot: result.data };
}
