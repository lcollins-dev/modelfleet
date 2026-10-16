import { z } from 'zod';

import { BackendId } from '@libs/backends';

import { enumValue, id, requestBody } from '../../../fields';
import { configurationText } from '../configuration';
import { ActivationPolicy } from '../deployment';
import { DeploymentResidencyDto, InstancePlacementDto, ListInstanceDto, PlacementRefusalDto } from './instance';

export const DeploymentInstancesResponseDto = z.object({
  instances: z.array(ListInstanceDto),

  placement: InstancePlacementDto,

  residency: DeploymentResidencyDto,
});
export type DeploymentInstancesResponseDto = z.infer<typeof DeploymentInstancesResponseDto>;

export const NodeInstancesResponseDto = z.object({
  instances: z.array(ListInstanceDto),
});
export type NodeInstancesResponseDto = z.infer<typeof NodeInstancesResponseDto>;

export const StartInstanceResponseDto = z.object({
  started: z.number(),

  /** The nodes the start passed over, so a deployment that came up in part says which part did not. */
  refused: z.array(PlacementRefusalDto),
});
export type StartInstanceResponseDto = z.infer<typeof StartInstanceResponseDto>;

/** Ordered by node name, then by the order each instance was issued in. */
export const InstanceListResponseDto = z.object({
  instances: z.array(ListInstanceDto),
});
export type InstanceListResponseDto = z.infer<typeof InstanceListResponseDto>;

export const PlacementPreviewRequestDto = requestBody({
  /** The saved deployment being edited, whose running instances already hold their nodes' share. */
  deploymentId: id().nullish(),

  modelId: id(),
  presetId: id().nullish(),

  /** Required where the draft names no preset, and refused where it names one. */
  backend: enumValue(BackendId).nullish(),

  activationPolicy: enumValue(ActivationPolicy),
  document: configurationText(),
});
export type PlacementPreviewRequestDto = z.infer<typeof PlacementPreviewRequestDto>;

export const PlacementPreviewResponseDto = z.object({
  /** A verdict on the placement the document names, reached the way a start reaches it. */
  placement: InstancePlacementDto,
});
export type PlacementPreviewResponseDto = z.infer<typeof PlacementPreviewResponseDto>;
