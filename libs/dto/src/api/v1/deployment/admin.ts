import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { enumValue, flag, id, optionalText, requestBody, text } from '../../../fields';
import { configurationText } from '../configuration';
import { ActivationPolicy, deploymentName, ListDeploymentDto } from './deployment';

export const DeploymentListRequestDto = requestBody({
  /** Matches a deployment's name or its description. */
  search: optionalText(512),
});
export type DeploymentListRequestDto = z.infer<typeof DeploymentListRequestDto>;

export const DeploymentListResponseDto = z.object({
  deploymentList: z.array(ListDeploymentDto),
  pages: z.number(),
  /** Every deployment the request matches, across all pages. */
  total: z.number(),
});
export type DeploymentListResponseDto = z.infer<typeof DeploymentListResponseDto>;

export const CreateDeploymentRequestDto = requestBody({
  name: deploymentName(),
  modelId: id(),
  presetId: id().nullish(),

  /** Required where the deployment names no preset, and refused where it names one. */
  backend: enumValue(BackendId).nullish(),

  activationPolicy: enumValue(ActivationPolicy),
  description: text(0, 512, { trim: true }).nullish(),
  document: configurationText(),
});
export type CreateDeploymentRequestDto = z.infer<typeof CreateDeploymentRequestDto>;

export const CreateDeploymentResponseDto = z.object({
  id: z.number(),
});
export type CreateDeploymentResponseDto = z.infer<typeof CreateDeploymentResponseDto>;

export const UpdateDeploymentStateRequestDto = requestBody({
  enabled: flag(),
});
export type UpdateDeploymentStateRequestDto = z.infer<typeof UpdateDeploymentStateRequestDto>;

export const UpdateDeploymentRequestDto = requestBody({
  name: deploymentName(),
  modelId: id(),
  presetId: id().nullish(),

  /** Required where the deployment names no preset, and refused where it names one. */
  backend: enumValue(BackendId).nullish(),

  activationPolicy: enumValue(ActivationPolicy),
  description: text(0, 512, { trim: true }),
  document: configurationText(),
});
export type UpdateDeploymentRequestDto = z.infer<typeof UpdateDeploymentRequestDto>;

export const PresetSwapRequestDto = requestBody({
  presetId: id().nullish(),

  /** Required where the swap names no preset, and refused where it names one. */
  backend: enumValue(BackendId).nullish(),

  document: configurationText(),
});
export type PresetSwapRequestDto = z.infer<typeof PresetSwapRequestDto>;

export const PresetSwapResponseDto = z.object({
  backend: z.enum(BackendId),
  presetName: z.string().nullable(),

  /** Override keys the deployment's current backend models and the new one does not. Saving the swap removes them. */
  droppedKeys: z.array(z.string()),
});
export type PresetSwapResponseDto = z.infer<typeof PresetSwapResponseDto>;

export const OutOfDateDeploymentsResponseDto = z.object({
  /** Deployments whose effective configuration has moved ahead of the revision their instances are being brought to. */
  outOfDate: z.number(),
});
export type OutOfDateDeploymentsResponseDto = z.infer<typeof OutOfDateDeploymentsResponseDto>;

export const ApplyDeploymentsResponseDto = z.object({
  /** Deployments this apply moved onto their current revision. */
  applied: z.number(),
});
export type ApplyDeploymentsResponseDto = z.infer<typeof ApplyDeploymentsResponseDto>;
