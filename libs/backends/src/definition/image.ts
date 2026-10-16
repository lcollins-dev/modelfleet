import { z } from 'zod';

import { BackendFieldType, IMAGE_FIELD, TextBackendField } from '../configuration';
import { IInstancePins, LaunchMode, launchModeOf } from '../launch';

export enum ImageVariant {
  CUDA = 'cuda',

  /** Accepted, and never selected until the agent presents AMD devices. */
  ROCM = 'rocm',

  CPU = 'cpu',
}

export const BackendImages = z
  .partialRecord(z.enum(ImageVariant), z.string().min(1))

  .refine(images => images[ImageVariant.CUDA] !== undefined || images[ImageVariant.CPU] !== undefined, {
    error: 'must name a cuda or a cpu image',
  });

export type BackendImages = z.infer<typeof BackendImages>;

/** The agent presents NVIDIA cards alone, so every placement holding a card takes the CUDA image. */
export function imageVariantOf(pins: IInstancePins): ImageVariant {
  return launchModeOf(pins) === LaunchMode.CPU_ONLY ? ImageVariant.CPU : ImageVariant.CUDA;
}

export function sharedImage(images: BackendImages): string | undefined {
  const cuda = images[ImageVariant.CUDA];

  return cuda !== undefined && cuda === images[ImageVariant.CPU] ? cuda : undefined;
}

/** Leaves `default` out where no image is shared, since a definition has to survive a JSON round trip. */
export function imageField(parts: { group: string; description: string; images: BackendImages }): TextBackendField {
  const field: TextBackendField = {
    name: IMAGE_FIELD,
    label: 'Container image',
    description: parts.description,
    group: parts.group,
    type: BackendFieldType.TEXT,
    minLength: 1,
    maxLength: 512,
  };
  const shared = sharedImage(parts.images);

  return shared === undefined ? field : { ...field, default: shared };
}
