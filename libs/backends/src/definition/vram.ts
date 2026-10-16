import { z } from 'zod';

import { BackendId } from '../backend-id';

export const GIB = 1024 ** 3;

const MAX_STAGES = 16;

export enum VramSource {
  HOOK = 'hook',

  CONFIGURATION = 'configuration',

  SIZE = 'size',

  WEIGHTS = 'weights',

  NONE = 'none',
}

export enum VramLaunchKind {
  STAGE_SHARES = 'stageShares',
}

const text = z.string().min(1);

export const VramEstimateDefinition = z.discriminatedUnion('source', [
  z.strictObject({ source: z.literal(VramSource.HOOK), hook: text }),
  z.strictObject({ source: z.literal(VramSource.CONFIGURATION), fractionField: text }),
  z.strictObject({ source: z.literal(VramSource.SIZE), gibField: text }),
  z.strictObject({
    source: z.literal(VramSource.WEIGHTS),
    factor: z.number().positive(),
    overheadBytesPerDevice: z.number().int().min(0),
  }),
  z.strictObject({ source: z.literal(VramSource.NONE) }),
]);

/** The engine's own per-stage shares for one model architecture. Only their ratio is used. */
export const ArchitectureStages = z.strictObject({
  architecture: text,

  /** Indexed by stage id. */
  shares: z.array(z.number().positive().max(1)).min(1).max(MAX_STAGES),
});

export const StageSharesLaunch = z.strictObject({
  kind: z.literal(VramLaunchKind.STAGE_SHARES),

  /** Written straight after `argv`, and left out where the document states no size. */
  flag: z.string().regex(/^-/, { error: 'must be a flag' }),

  shareKey: z.string().regex(/^[a-z][a-z0-9_]*$/, { error: 'must be a snake_case key' }),

  /** An architecture the table lacks cannot launch. */
  architectures: z
    .array(ArchitectureStages)
    .min(1)

    .refine(entries => new Set(entries.map(entry => entry.architecture)).size === entries.length, {
      error: 'names an architecture twice',
    }),
});

/** Sizing never reads `launch`; it is how the size reaches the engine. */
export const VramDefinition = z.strictObject({
  estimate: VramEstimateDefinition,
  launch: StageSharesLaunch.optional(),
});

export type VramEstimateDefinition = z.infer<typeof VramEstimateDefinition>;

export type ArchitectureStages = z.infer<typeof ArchitectureStages>;

export type StageSharesLaunch = z.infer<typeof StageSharesLaunch>;

export type VramDefinition = z.infer<typeof VramDefinition>;

export function stageSharesOf(launch: StageSharesLaunch, architecture: string | null): number[] | undefined {
  return launch.architectures.find(entry => entry.architecture === architecture)?.shares;
}

export function unlistedStages(vram: VramDefinition, architecture: string | null): boolean {
  return vram.launch !== undefined && stageSharesOf(vram.launch, architecture) === undefined;
}

export function unlistedStagesMessage(backend: BackendId, architecture: string | null): string {
  const held = architecture === null ? 'no architecture' : `the ${architecture} architecture`;

  return `has ${held}, which ${backend} lists no single-card pipeline for`;
}
