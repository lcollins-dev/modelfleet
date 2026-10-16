import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { enumValue, optionalText, requestBody, selection, text } from '../../../fields';
import { configurationText } from '../configuration';
import { ListPresetDto } from './preset';

export const PresetListRequestDto = requestBody({
  /** Matches a preset's name or its description. */
  search: optionalText(512),

  /** Absent lists every backend. */
  backend: selection(enumValue(BackendId), 1, Object.values(BackendId).length).optional(),
});
export type PresetListRequestDto = z.infer<typeof PresetListRequestDto>;

export const PresetListResponseDto = z.object({
  presetList: z.array(ListPresetDto),
  pages: z.number(),
});
export type PresetListResponseDto = z.infer<typeof PresetListResponseDto>;

export const CreatePresetRequestDto = requestBody({
  name: text(1, 128, { trim: true }),

  description: text(0, 512, { trim: true }).nullish(),

  backend: enumValue(BackendId),

  document: configurationText(),
});
export type CreatePresetRequestDto = z.infer<typeof CreatePresetRequestDto>;

export const CreatePresetResponseDto = z.object({
  id: z.number(),
});
export type CreatePresetResponseDto = z.infer<typeof CreatePresetResponseDto>;

export const UpdatePresetRequestDto = requestBody({
  name: text(1, 128, { trim: true }),
  description: text(0, 512, { trim: true }),
  document: configurationText(),
});
export type UpdatePresetRequestDto = z.infer<typeof UpdatePresetRequestDto>;

export const PresetImpactRequestDto = requestBody({
  /** Measured against the document the preset holds now. */
  document: configurationText(),
});
export type PresetImpactRequestDto = z.infer<typeof PresetImpactRequestDto>;

export const PresetChangedFieldDto = z.object({
  key: z.string(),

  /** Deployments taking the preset's value for the key rather than overriding it. */
  inheritingDeployments: z.number(),
});
export type PresetChangedFieldDto = z.infer<typeof PresetChangedFieldDto>;

export const PresetImpactResponseDto = z.object({
  /** Every deployment applying the preset, whether or not it inherits a changed key. */
  deployments: z.number(),

  /** Deployments inheriting at least one changed key. */
  affectedDeployments: z.number(),

  /** Ordered by key. */
  changedFields: z.array(PresetChangedFieldDto),
});
export type PresetImpactResponseDto = z.infer<typeof PresetImpactResponseDto>;
