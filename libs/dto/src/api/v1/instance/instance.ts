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
  EVICTED = 'evicted',
  SETTINGS_CHANGED = 'settings-changed',
}

export enum ResidencyRule {
  ALWAYS = 'always',
  IDLE_TIMEOUT = 'idle-timeout',
  DISABLED = 'disabled',
}

export enum ExpectedUsageSource {
  CONFIGURED = 'configured',
  DECLARED = 'declared',
  ESTIMATED = 'estimated',
}

export const ExpectedUsageDto = z.object({
  bytes: z.number(),
  source: z.enum(ExpectedUsageSource),

  /** Left out of `bytes`. */
  hostWeightsBytes: z.number(),

  hostResidentBytes: z.number(),

  hostCacheBytes: z.number(),
});
export type ExpectedUsageDto = z.infer<typeof ExpectedUsageDto>;

export enum PlacementProblemReason {
  NOT_ENOUGH_VRAM = 'notEnoughVram',
  NOT_ENOUGH_RAM = 'notEnoughRam',
  MODEL_NOT_ON_NODE = 'modelNotOnNode',
  NO_READINGS = 'noReadings',
  GPU_NOT_MEASURED = 'gpuNotMeasured',
  OTHER = 'other',
}

export const PlacementCardCapacityDto = z.object({
  deviceKey: z.string(),
  name: z.string().nullable(),
  totalBytes: z.number().nullable(),
  usedBytes: z.number().nullable(),
  predictedBytes: z.number(),
  headroomBytes: z.number(),

  /** Before headroom. */
  freeBytes: z.number().nullable(),

  short: z.boolean(),
});
export type PlacementCardCapacityDto = z.infer<typeof PlacementCardCapacityDto>;

export const PlacementHostWeightsDto = z.object({
  /** Includes `cacheBytes`. */
  neededBytes: z.number(),

  cacheBytes: z.number(),

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

  onOlderSettings: z.boolean(),

  restartRequested: z.boolean(),

  /** What the node reported: the image a launch is pulling, or why the launch failed, or the backend's last output. */
  message: z.string().nullable(),

  exitCode: z.number().nullable(),

  startedDate: timestamp().nullable(),

  reportedDate: timestamp().nullable(),

  createdDate: timestamp(),
});
export type ListInstanceDto = z.infer<typeof ListInstanceDto>;

/** An idle instance a start would stop to make room, had it no room otherwise. */
export const PlacementEvictionDto = z.object({
  deploymentName: z.string(),
  instanceKey: z.string(),
  devices: z.array(InstanceDeviceDto),

  idleMs: z.number(),

  releasedBytes: z.number(),
});
export type PlacementEvictionDto = z.infer<typeof PlacementEvictionDto>;

/** A figure is null until every instance has a reading for it. */
export const PlacementMeasuredDto = z.object({
  vramBytes: z.number().nullable(),
  ramBytes: z.number().nullable(),
});
export type PlacementMeasuredDto = z.infer<typeof PlacementMeasuredDto>;

export const PlacementNodeDto = z.object({
  nodeId: z.number(),
  nodeName: z.string(),

  devices: z.array(InstanceDeviceDto),

  /** Per node, rather than across the fleet. */
  replicas: z.number(),

  running: z.number(),
  problem: z.string().nullable(),

  /** Null exactly where `problem` is. */
  problemReason: z.enum(PlacementProblemReason).nullable(),

  expectedUsage: ExpectedUsageDto.nullable(),

  /** Set on a deployment's own read where the node holds its full share. Null on a preview of a draft. */
  measured: PlacementMeasuredDto.nullable(),

  capacity: PlacementCapacityDto.nullable(),

  /** Non-empty where the placement fits only after these are stopped. `problem` is then null. */
  evictions: z.array(PlacementEvictionDto),
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

  makingRoomNodeIds: z.array(z.number()),

  /** True between stopping an instance for restart and starting its replacement. */
  restarting: z.boolean(),
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
