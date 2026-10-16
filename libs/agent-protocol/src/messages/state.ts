import { z } from 'zod';

import { BackendId, IInstancePins } from '@libs/backends';
import { IModelMetadata } from '@libs/backends/runtime';

import { MAX_MESSAGE_LENGTH } from './limits';
import { MAX_ARCHITECTURE_LENGTH, MAX_MODEL_PATH_LENGTH, MAX_QUANTISATION_LENGTH } from './model';
import { MAX_DEVICE_KEY_LENGTH } from './telemetry';

/** The agent alone reports this. */
export enum InstanceState {
  STARTING = 'starting',
  READY = 'ready',
  FAILED = 'failed',
}

export const MAX_INSTANCES_PER_NODE = 256;
export const MAX_DEVICES_PER_INSTANCE = 16;
export const MAX_COMPANIONS_PER_INSTANCE = 16;
export const MAX_COMPANION_FIELD_LENGTH = 64;
export const MAX_SERVED_MODEL_LENGTH = 128;
export const MAX_IMAGE_LENGTH = 512;

export const companionPathSchema = z.object({
  /** The agent builds a container path from this, so the pattern keeps a name that would climb out off the wire. */
  field: z
    .string()
    .min(1)
    .max(MAX_COMPANION_FIELD_LENGTH)
    .regex(/^[A-Za-z0-9_]+$/),

  path: z.string().min(1).max(MAX_MODEL_PATH_LENGTH),
});
export type CompanionPath = z.infer<typeof companionPathSchema>;

/** Everything an adapter is told about the weights. A field the model's format does not carry is null. */
export const desiredModelSchema = z.object({
  /** The sum of every shard. */
  sizeBytes: z.number().int().nonnegative(),

  architecture: z.string().min(1).max(MAX_ARCHITECTURE_LENGTH).nullable(),
  quantisation: z.string().min(1).max(MAX_QUANTISATION_LENGTH).nullable(),
  layerCount: z.number().int().nonnegative().nullable(),
  embeddingLength: z.number().int().nonnegative().nullable(),
  headCount: z.number().int().nonnegative().nullable(),
  headCountKv: z.number().int().nonnegative().nullable(),
  contextLength: z.number().int().nonnegative().nullable(),
}) satisfies z.ZodType<IModelMetadata>;
export type DesiredModel = z.infer<typeof desiredModelSchema>;

/** An instance pinned to nothing has nowhere to run, which the two fields cannot rule out on their own. */
const pinsSomething = (pins: { cpu: boolean; gpus: string[] }): boolean => pins.cpu || pins.gpus.length > 0;

export const instancePinsSchema = z
  .object({
    cpu: z.boolean(),

    /** The vendor UUIDs this instance is pinned to, the same identity a GPU row and telemetry both carry. */
    gpus: z.array(z.string().min(1).max(MAX_DEVICE_KEY_LENGTH)).max(MAX_DEVICES_PER_INSTANCE),
  })
  .refine(pinsSomething, { error: 'must pin the CPU, at least one GPU, or both' }) satisfies z.ZodType<IInstancePins>;

export const desiredInstanceSchema = z.object({
  instanceKey: z.uuid(),

  /** Raised by the server whenever this instance's effective configuration changes. */
  revision: z.number().int().nonnegative(),

  backend: z.enum(BackendId),

  /** The name the backend reports as `model`: the deployment the gateway routes on, not the weights. */
  servedModel: z.string().min(1).max(MAX_SERVED_MODEL_LENGTH),

  model: desiredModelSchema,

  /** This node's own path to the weights: the first shard, or the directory where the format is one. */
  weightsPath: z.string().min(1).max(MAX_MODEL_PATH_LENGTH),

  /** Absent where the deployment names no companion, which is what left the protocol version alone. */
  companionPaths: z.array(companionPathSchema).max(MAX_COMPANIONS_PER_INSTANCE).optional(),

  /** The backend's half of the effective configuration, already validated against its declaration. */
  configuration: z.looseObject({}),

  /** The hardware the placement pinned, which decides the launch mode no configuration key carries. */
  pins: instancePinsSchema,

  /** Null takes the definition's image for the placement's variant. */
  image: z.string().min(1).max(MAX_IMAGE_LENGTH).nullable(),
});
export type DesiredInstance = z.infer<typeof desiredInstanceSchema>;

export const observedInstanceSchema = z.object({
  instanceKey: z.uuid(),
  revision: z.number().int().nonnegative(),
  instanceState: z.enum(InstanceState),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH).nullable(),
  uptimeMs: z.number().int().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),

  /** A launch failed for overrunning its readiness timeout, whose container is still running. Absent reads as false. */
  overran: z.boolean().optional(),
});
export type ObservedInstance = z.infer<typeof observedInstanceSchema>;

export const serverDesiredStateSchema = z.object({
  /** The node's whole set: an instance absent from this list is one the server wants gone. */
  instances: z.array(desiredInstanceSchema).max(MAX_INSTANCES_PER_NODE),

  /** Raised by one on each push, ordering desired state for one node. */
  generation: z.number().int().nonnegative(),
});
export type ServerDesiredState = z.infer<typeof serverDesiredStateSchema>;

export const agentObservedStateSchema = z.object({
  desiredGeneration: z.number().int().nonnegative().nullable(),

  /** Everything the agent finds on the node, including instances the server wants gone. */
  instances: z.array(observedInstanceSchema).max(MAX_INSTANCES_PER_NODE),
});
export type AgentObservedState = z.infer<typeof agentObservedStateSchema>;
