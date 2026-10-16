import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from './limits';
import { MAX_MODEL_DIRECTORIES, MAX_MODEL_PATH_LENGTH } from './model';

export enum GpuVendor {
  NVIDIA = 'nvidia',
}

export enum ProcessAttribution {
  EXACT = 'exact',
  APPROXIMATE = 'approximate',
  UNAVAILABLE = 'unavailable',
}

export enum TelemetryState {
  OK = 'ok',
  DEGRADED = 'degraded',
}

export enum ModelDirectoryWriteAccess {
  WRITABLE = 'writable',
  READ_ONLY = 'read_only',
  DENIED = 'denied',
}

export enum TelemetryErrorScope {
  PROVIDER = 'provider',
  DEVICE = 'device',
  METRIC = 'metric',
}

export const MAX_DEVICES_PER_NODE = 64;
export const MAX_PROCESSES_PER_DEVICE = 256;
export const MAX_TELEMETRY_ERRORS = 64;
export const MAX_DEVICE_KEY_LENGTH = 128;
export const MAX_DEVICE_NAME_LENGTH = 128;
export const MAX_PCI_BUS_ID_LENGTH = 64;
export const MAX_PROCESS_NAME_LENGTH = 256;
export const MAX_CONTAINER_ID_LENGTH = 128;
export const MAX_CONTAINER_NAME_LENGTH = 256;
export const MAX_CPU_MODEL_LENGTH = 128;
export const MAX_TELEMETRY_METRIC_LENGTH = 64;

/** The vendor UUID. */
export const deviceKeySchema = z.string().min(1).max(MAX_DEVICE_KEY_LENGTH);

export const gpuDeviceSchema = z.object({
  deviceKey: deviceKeySchema,
  vendor: z.enum(GpuVendor),
  name: z.string().min(1).max(MAX_DEVICE_NAME_LENGTH).nullable(),
  pciBusId: z.string().min(1).max(MAX_PCI_BUS_ID_LENGTH).nullable(),
  memoryTotalBytes: z.number().int().nonnegative().nullable(),

  /** The ordinal at capture time; identity is `deviceKey`. Absent from an agent that predates it. */
  index: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_DEVICES_PER_NODE - 1)
    .optional(),
});
export type GpuDevice = z.infer<typeof gpuDeviceSchema>;

export const gpuProcessSchema = z.object({
  /** A host identifier, whatever namespace the reader ran in. */
  pid: z.number().int().nonnegative(),
  usedBytes: z.number().int().nonnegative().nullable(),
  name: z.string().min(1).max(MAX_PROCESS_NAME_LENGTH).nullable(),
  containerId: z.string().min(1).max(MAX_CONTAINER_ID_LENGTH).nullable(),
  containerName: z.string().min(1).max(MAX_CONTAINER_NAME_LENGTH).nullable(),

  /** Absent from an agent that predates it. */
  instanceKey: z.uuid().nullable().optional(),
});
export type GpuProcess = z.infer<typeof gpuProcessSchema>;

export const gpuDeviceMetricsSchema = z.object({
  deviceKey: deviceKeySchema,

  /** The ordinal at capture time; identity is `deviceKey`. */
  index: z.number().int().nonnegative(),

  memoryUsedBytes: z.number().int().nonnegative().nullable(),
  utilisationPercent: z.number().int().min(0).max(100).nullable(),
  temperatureC: z.number().int().nullable(),
  powerDrawWatts: z.number().int().nonnegative().nullable(),
  processAttribution: z.enum(ProcessAttribution),
  processes: z.array(gpuProcessSchema).max(MAX_PROCESSES_PER_DEVICE),
});
export type GpuDeviceMetrics = z.infer<typeof gpuDeviceMetricsSchema>;

/** Both figures are null where the directory could not be read. */
export const modelDirectorySpaceSchema = z.object({
  path: z.string().min(1).max(MAX_MODEL_PATH_LENGTH),
  freeBytes: z.number().int().nonnegative().nullable(),
  totalBytes: z.number().int().nonnegative().nullable(),

  /** Null where it could not be checked. Absent from an agent that predates it. */
  writeAccess: z.enum(ModelDirectoryWriteAccess).nullable().optional(),
});
export type ModelDirectorySpace = z.infer<typeof modelDirectorySpaceSchema>;

export const hostResourcesSchema = z.object({
  cpuModel: z.string().min(1).max(MAX_CPU_MODEL_LENGTH).nullable(),
  cpuCount: z.number().int().nonnegative(),
  loadAverage1m: z.number().nonnegative().nullable(),
  memoryTotalBytes: z.number().int().nonnegative(),
  memoryFreeBytes: z.number().int().nonnegative(),

  /** In configured order, so the first is where downloads land. Absent from an agent that predates it. */
  modelDirectories: z.array(modelDirectorySpaceSchema).max(MAX_MODEL_DIRECTORIES).optional(),
});
export type HostResources = z.infer<typeof hostResourcesSchema>;

export const telemetryErrorSchema = z.object({
  scope: z.enum(TelemetryErrorScope),
  deviceKey: deviceKeySchema.nullable(),
  metric: z.string().min(1).max(MAX_TELEMETRY_METRIC_LENGTH).nullable(),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});
export type TelemetryError = z.infer<typeof telemetryErrorSchema>;

/** The node's whole device set: a device absent from this list is one the node no longer has. */
export const agentGpuInventorySchema = z.object({
  devices: z.array(gpuDeviceSchema).max(MAX_DEVICES_PER_NODE),
});
export type AgentGpuInventory = z.infer<typeof agentGpuInventorySchema>;

export const agentTelemetrySchema = z.object({
  capturedAt: z.iso.datetime({ offset: true }),
  telemetryState: z.enum(TelemetryState),
  devices: z.array(gpuDeviceMetricsSchema).max(MAX_DEVICES_PER_NODE),
  host: hostResourcesSchema,
  errors: z.array(telemetryErrorSchema).max(MAX_TELEMETRY_ERRORS),
});
export type AgentTelemetry = z.infer<typeof agentTelemetrySchema>;
