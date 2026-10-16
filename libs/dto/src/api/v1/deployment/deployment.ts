import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { text, timestamp } from '../../../fields';
import { configurationDocument, EffectiveConfigurationDto } from '../configuration';
import { ModelLicenceDto } from '../model';

const DEPLOYMENT_NAME_PATTERN = /^[a-zA-Z0-9]+(?:[-._/:][a-zA-Z0-9]+)*$/;

export enum ActivationPolicy {
  ALWAYS = 'always',
  ON_DEMAND = 'onDemand',
}

export const ListDeploymentDto = z.object({
  id: z.number(),

  name: z.string(),

  modelId: z.number(),
  modelName: z.string(),
  modelLicence: ModelLicenceDto.nullable(),
  presetId: z.number().nullable(),
  presetName: z.string().nullable(),

  backend: z.enum(BackendId),

  activationPolicy: z.enum(ActivationPolicy),

  enabled: z.boolean(),

  outOfDate: z.boolean(),

  createdDate: timestamp(),
});
export type ListDeploymentDto = z.infer<typeof ListDeploymentDto>;

export const DeploymentDto = ListDeploymentDto.extend({
  description: z.string().nullable(),

  schemaVersion: z.number(),

  document: z.string(),

  /** The whole configuration where the deployment names no preset. */
  overrides: configurationDocument,

  updatedDate: timestamp(),
});
export type DeploymentDto = z.infer<typeof DeploymentDto>;

export const DeploymentConfigurationDto = EffectiveConfigurationDto.extend({
  presetId: z.number().nullable(),
  presetName: z.string().nullable(),
});
export type DeploymentConfigurationDto = z.infer<typeof DeploymentConfigurationDto>;

export const deploymentName = () =>
  text(1, 128, { trim: true }).regex(DEPLOYMENT_NAME_PATTERN, {
    error: 'Use only letters, numbers, hyphens, dots, underscores, slashes and colons, with no spaces.',
  });
