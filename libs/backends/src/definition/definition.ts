import { z } from 'zod';

import { BackendId } from '../backend-id';
import { BackendDeclaration } from '../configuration';
import { LaunchMode } from '../launch';
import { ContainerSettings } from './container';
import { BackendImages } from './image';
import { OperationDefinitions } from './operation';
import { Readiness } from './readiness';
import { ArgumentGroup } from './template';
import { VramDefinition } from './vram';

export const DEFINITION_FORMAT_VERSION = 1;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks each part alone. `validateDefinition` adds the checks across parts. */
export const BackendDefinition = z.strictObject({
  id: z.enum(BackendId),
  formatVersion: z.literal(DEFINITION_FORMAT_VERSION),

  images: BackendImages,

  entrypoint: z.array(z.string().min(1)).min(1).optional(),

  argv: z.array(ArgumentGroup),

  /** Come after `argv`, and before the declared fields, so `extraFlags` still resolves over them. */
  launchModeArgv: z.partialRecord(z.enum(LaunchMode), z.array(ArgumentGroup)),

  /** A variable is left unset where any placeholder in its value has no value. */
  environment: z.record(z.string().regex(ENVIRONMENT_NAME, { error: 'must be a variable name' }), z.string()),
  port: z.number().int().min(1).max(65_535),

  modelMount: z
    .string()
    .regex(/^\/./, { error: 'must be an absolute directory' })
    .refine(path => !path.split('/').includes('..'), { error: 'must not climb out with ..' }),

  /** Replaces the weights' own name inside `modelMount`. A split set keeps its shards' names. */
  weightsName: z
    .string()
    .regex(/^[^/]+$/, { error: 'must be one path segment' })
    .refine(name => name !== '.' && name !== '..', { error: 'must name a file or directory' })
    .optional(),

  container: ContainerSettings,
  readiness: Readiness,
  declaration: BackendDeclaration,
  operations: OperationDefinitions,
  vram: VramDefinition,
});

export type BackendDefinition = z.infer<typeof BackendDefinition>;
