import { z } from 'zod';

export enum DevicePresentation {
  ENVIRONMENT = 'environment',

  DEVICE_REQUEST = 'deviceRequest',
}

export const ContainerSettings = z.strictObject({
  multiDevice: z.boolean(),

  cpuOffload: z.boolean(),

  devicePresentation: z.enum(DevicePresentation),

  /** Lists the device UUIDs in pin order in `CUDA_VISIBLE_DEVICES`. Set only for an engine that accepts UUIDs there. */
  pinOrderedDevices: z.boolean().optional(),

  stopGraceSeconds: z.number().int().min(0),

  sharedMemoryBytes: z.number().int().min(0),
});

export type ContainerSettings = z.infer<typeof ContainerSettings>;

/** The agent owns device presentation, so a definition setting one of these could widen what the placement pinned. */
const RESERVED_ENVIRONMENT_PREFIX = 'NVIDIA_';

const RESERVED_ENVIRONMENT = new Set([
  'CUDA_VISIBLE_DEVICES',
  'HIP_VISIBLE_DEVICES',
  'ROCR_VISIBLE_DEVICES',
  'GPU_DEVICE_ORDINAL',
]);

export function isReservedEnvironment(name: string): boolean {
  return name.startsWith(RESERVED_ENVIRONMENT_PREFIX) || RESERVED_ENVIRONMENT.has(name);
}
