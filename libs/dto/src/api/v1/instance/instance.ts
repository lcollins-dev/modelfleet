import { z } from 'zod';

import { timestamp } from '../../../fields';
import { NodeState } from '../node';

export enum InstanceState {
  STARTING = 'starting',
  READY = 'ready',
  FAILED = 'failed',
}

export enum InstanceChangeReason {
  BY_HAND = 'by-hand',
  ALWAYS_POLICY = 'always-policy',
  IDLE_TIMEOUT = 'idle-timeout',
  INSTANCE_FAILED = 'instance-failed',
  DEPLOYMENT_DISABLED = 'deployment-disabled',
  LAUNCH_OVERRAN = 'launch-overran',
  ON_REQUEST = 'on-request',
}

export enum ResidencyRule {
  ALWAYS = 'always',
  IDLE_TIMEOUT = 'idle-timeout',
  DISABLED = 'disabled',
}

export enum ExpectedUsageSource {
  CONFIGURED = 'configured',
  DECLARED = 'declared',
  MEASURED = 'measured',
  ESTIMATED = 'estimated',
}

export const ExpectedUsageDto = z.object({
  bytes: z.number(),
  source: z.enum(ExpectedUsageSource),

  /** Left out of `bytes`. */
  hostWeightsBytes: z.number(),

  hostResidentBytes: z.number(),
});
export type ExpectedUsageDto = z.infer<typeof ExpectedUsageDto>;

export const PlacementCardCapacityDto = z.object({
  deviceKey: z.string(),
  name: z.string().nullable(),
  totalBytes: z.number().nullable(),
  usedBytes: z.number().nullable(),
  predictedBytes: z.number(),
  headroomBytes: z.number(),

  /** Before headroom. */
  freeBytes: z.number().nullable(),
});
export type PlacementCardCapacityDto = z.infer<typeof PlacementCardCapacityDto>;

export const PlacementHostWeightsDto = z.object({
  neededBytes: z.number(),

  /** After what loading instances hold. */
  freeBytes: z.number(),
});
export type PlacementHostWeightsDto = z.infer<typeof PlacementHostWeightsDto>;

export const PlacementCapacityDto = z.object({
  expectedBytes: z.number(),

  /** The pool after headroom, including free system memory where the placement may offload to it. */
  availableBytes: z.number().nullable(),

  hostFreeBytes: z.number().nullable(),
  cards: z.array(PlacementCardCapacityDto),

  hostWeights: PlacementHostWeightsDto.nullable(),
});
export type PlacementCapacityDto = z.infer<typeof PlacementCapacityDto>;

export const InstanceDeviceDto = z.object({
  deviceKey: z.string(),
  name: z.string().nullable(),
});
export type InstanceDeviceDto = z.infer<typeof InstanceDeviceDto>;

export const ListInstanceDto = z.object({
  instanceKey: z.string(),

  deploymentId: z.number(),
  deploymentName: z.string(),

  nodeId: z.number(),
  nodeName: z.string(),
  nodeState: z.enum(NodeState),

  devices: z.array(InstanceDeviceDto),

  state: z.enum(InstanceState),

  /** The backend's last output where the launch failed, with the extra flag values taken out. */
  message: z.string().nullable(),

  exitCode: z.number().nullable(),

  startedDate: timestamp().nullable(),

  reportedDate: timestamp().nullable(),

  createdDate: timestamp(),
});
export type ListInstanceDto = z.infer<typeof ListInstanceDto>;

export const PlacementNodeDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),

  devices: z.array(InstanceDeviceDto),

  /** Per node, rather than across the fleet. */
  replicas: z.number(),

  running: z.number(),
  problem: z.string().nullable(),

  expectedUsage: ExpectedUsageDto.nullable(),

  capacity: PlacementCapacityDto.nullable(),
});
export type PlacementNodeDto = z.infer<typeof PlacementNodeDto>;

export const DeploymentResidencyDto = z.object({
  rule: z.enum(ResidencyRule),

  idleTimeoutMs: z.number().nullable(),

  /** When a request was last routed here, stamped periodically rather than on every request. */
  lastUsedDate: timestamp().nullable(),

  idleSince: timestamp().nullable(),

  inFlight: z.number(),

  launchFailures: z.number(),

  retryDate: timestamp().nullable(),

  givenUp: z.boolean(),

  lastLaunchFailure: z.string().nullable(),
});
export type DeploymentResidencyDto = z.infer<typeof DeploymentResidencyDto>;

export const InstancePlacementDto = z.object({
  nodes: z.array(PlacementNodeDto),

  problem: z.string().nullable(),
});
export type InstancePlacementDto = z.infer<typeof InstancePlacementDto>;

export const PlacementRefusalDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),
  problem: z.string(),
  capacity: PlacementCapacityDto.nullable(),
});
export type PlacementRefusalDto = z.infer<typeof PlacementRefusalDto>;
