import { z } from 'zod';

import { timestamp } from '../../../fields';

export enum GpuVendor {
  NVIDIA = 'nvidia',
}

export enum GpuProcessAttribution {
  EXACT = 'exact',
  APPROXIMATE = 'approximate',
  UNAVAILABLE = 'unavailable',
}

export enum NodeTelemetryState {
  OK = 'ok',
  DEGRADED = 'degraded',
}

export enum ModelDirectoryWriteAccess {
  WRITABLE = 'writable',
  READ_ONLY = 'read_only',
  DENIED = 'denied',
}

export enum GpuTelemetryErrorScope {
  PROVIDER = 'provider',
  DEVICE = 'device',
  METRIC = 'metric',
}

export const GpuProcessDto = z.object({
  /** A host identifier, whatever namespace the reader ran in. */
  pid: z.number(),
  usedBytes: z.number().nullable(),
  name: z.string().nullable(),
  containerId: z.string().nullable(),
  containerName: z.string().nullable(),

  instanceKey: z.string().nullable(),

  deploymentName: z.string().nullable(),
});
export type GpuProcessDto = z.infer<typeof GpuProcessDto>;

export const GpuPredictionDto = z.object({
  instanceKey: z.string(),

  deploymentName: z.string().nullable(),

  bytes: z.number(),
});
export type GpuPredictionDto = z.infer<typeof GpuPredictionDto>;

/** A null metric is one nothing supplied, never a zero reading. */
export const GpuTelemetryDto = z.object({
  deviceKey: z.string(),
  vendor: z.enum(GpuVendor),
  name: z.string().nullable(),
  pciBusId: z.string().nullable(),
  memoryTotalBytes: z.number().nullable(),
  lastReportedDate: timestamp(),

  /** Orders the list. Identity is `deviceKey`. */
  index: z.number().nullable(),
  memoryUsedBytes: z.number().nullable(),
  utilisationPercent: z.number().nullable(),
  temperatureC: z.number().nullable(),
  powerDrawWatts: z.number().nullable(),
  processAttribution: z.enum(GpuProcessAttribution).nullable(),
  processes: z.array(GpuProcessDto),

  predictions: z.array(GpuPredictionDto),
});
export type GpuTelemetryDto = z.infer<typeof GpuTelemetryDto>;

export const ModelDirectorySpaceDto = z.object({
  path: z.string(),
  freeBytes: z.number().nullable(),
  totalBytes: z.number().nullable(),

  writeAccess: z.enum(ModelDirectoryWriteAccess).nullable(),
});
export type ModelDirectorySpaceDto = z.infer<typeof ModelDirectorySpaceDto>;

export const NodeHostTelemetryDto = z.object({
  cpuModel: z.string().nullable(),
  cpuCount: z.number(),
  loadAverage1m: z.number().nullable(),
  memoryTotalBytes: z.number(),
  memoryFreeBytes: z.number(),

  /** In the node's configured order, so the first is where downloads land. */
  modelDirectories: z.array(ModelDirectorySpaceDto),
});
export type NodeHostTelemetryDto = z.infer<typeof NodeHostTelemetryDto>;

export const GpuTelemetryErrorDto = z.object({
  scope: z.enum(GpuTelemetryErrorScope),
  deviceKey: z.string().nullable(),
  metric: z.string().nullable(),
  message: z.string(),
});
export type GpuTelemetryErrorDto = z.infer<typeof GpuTelemetryErrorDto>;

export const NodeTelemetryStatusDto = z.object({
  telemetryState: z.enum(NodeTelemetryState).nullable(),
  /** On the node's clock. */
  capturedAt: timestamp().nullable(),
  /** On the server's clock. */
  receivedAt: timestamp().nullable(),
  host: NodeHostTelemetryDto.nullable(),
  devices: z.array(GpuTelemetryDto),
  errors: z.array(GpuTelemetryErrorDto),

  /** Kept back on every card. Free to a start is total, less used, predictions and this. */
  headroomBytes: z.number(),
});
export type NodeTelemetryStatusDto = z.infer<typeof NodeTelemetryStatusDto>;
