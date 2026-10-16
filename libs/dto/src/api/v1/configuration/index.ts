import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { text } from '../../../fields';

const MAX_DOCUMENT_LENGTH = 64_000;

export type ConfigurationValue = string | number | boolean | null | IConfigurationList | IConfigurationObject;

export interface IConfigurationList extends Array<ConfigurationValue> {}

export interface IConfigurationObject {
  [key: string]: ConfigurationValue;
}

// A recursive union cannot be inferred, so the schema is checked against the type it parses to.
export const configurationValue: z.ZodType<ConfigurationValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(configurationValue),
    z.record(z.string(), configurationValue),
  ])
);

/** The backend's declared keys, validated, plus every key it does not declare, untouched. */
export const configurationDocument = z.record(z.string(), configurationValue);
export type ConfigurationDocument = z.infer<typeof configurationDocument>;

/** Stored configuration names a device by its key. A device ordinal never appears in one. */
export interface IPinnedGpu {
  nodeId: number;
  deviceKey: string;
}

export const configurationText = () => text(0, MAX_DOCUMENT_LENGTH);

export enum ConfigurationSource {
  PRESET = 'preset',
  DEPLOYMENT = 'deployment',

  /** The declared default, which is passed because no document holds the key. */
  DECLARATION = 'declaration',
}

export const EffectiveConfigurationEntryDto = z.object({
  key: z.string(),

  value: configurationValue,

  source: z.enum(ConfigurationSource),

  /** The preset's value. Present only where the deployment overrides a key the preset also sets. */
  presetValue: configurationValue.optional(),

  /** False where neither the backend's declaration nor the fleet keys model the key, so nothing validated it. */
  modelled: z.boolean(),
});
export type EffectiveConfigurationEntryDto = z.infer<typeof EffectiveConfigurationEntryDto>;

/** A preset overlaid with a deployment's overrides. */
export const EffectiveConfigurationDto = z.object({
  backend: z.enum(BackendId),

  /** Fleet keys first, then the backend's declared fields in declaration order, then unmodelled keys by name. */
  entries: z.array(EffectiveConfigurationEntryDto),

  /** The keys the documents set, declared defaults excluded, so nothing downstream resolves a default twice. */
  configuration: configurationDocument,
});
export type EffectiveConfigurationDto = z.infer<typeof EffectiveConfigurationDto>;
