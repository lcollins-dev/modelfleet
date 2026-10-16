import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { timestamp } from '../../../fields';
import { configurationDocument } from '../configuration';

export const ListPresetDto = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  backend: z.enum(BackendId),

  deployments: z.number(),

  createdDate: timestamp(),
});
export type ListPresetDto = z.infer<typeof ListPresetDto>;

export const PresetDto = ListPresetDto.extend({
  schemaVersion: z.number(),

  /** The YAML as authored, comments and key order intact. */
  document: z.string(),

  configuration: configurationDocument,
  updatedDate: timestamp(),
});
export type PresetDto = z.infer<typeof PresetDto>;
